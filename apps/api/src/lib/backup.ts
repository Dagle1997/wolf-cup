// ---------------------------------------------------------------------------
// Nightly SQLite → R2 backup.
// ---------------------------------------------------------------------------
//
// Mechanism:
//   1. VACUUM INTO → consistent snapshot of the live DB to a temp file
//      (safe under concurrent reads; briefly blocks writers)
//   2. gzip → ~3-5x reduction on SQLite pages
//   3. PutObject → dedicated `wolf-cup-backup` R2 bucket (separate creds from
//      the photo bucket — if one set of keys leaks, the other is unaffected)
//   4. Retention prune → see backup-retention.ts
//
// All failures are logged and swallowed by the cron wrapper in index.ts so a
// bad backup run never crashes the API. The manual /admin/backup/now endpoint
// DOES surface errors so an operator sees exactly what broke.
// ---------------------------------------------------------------------------

import { createClient } from '@libsql/client';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { readFile, unlink } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBackupKey, planRetention } from './backup-retention.js';

const R2_ACCOUNT_ID = process.env['R2_ACCOUNT_ID'] ?? '';
const R2_BACKUP_ACCESS_KEY_ID = process.env['R2_BACKUP_ACCESS_KEY_ID'] ?? '';
const R2_BACKUP_SECRET_ACCESS_KEY = process.env['R2_BACKUP_SECRET_ACCESS_KEY'] ?? '';
const R2_BACKUP_BUCKET_NAME = process.env['R2_BACKUP_BUCKET_NAME'] ?? '';

export const backupConfigured = Boolean(
  R2_ACCOUNT_ID &&
    R2_BACKUP_ACCESS_KEY_ID &&
    R2_BACKUP_SECRET_ACCESS_KEY &&
    R2_BACKUP_BUCKET_NAME,
);

const backupClient = backupConfigured
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_BACKUP_ACCESS_KEY_ID,
        secretAccessKey: R2_BACKUP_SECRET_ACCESS_KEY,
      },
    })
  : null;

export interface BackupResult {
  key: string;
  bytesUploaded: number;
  pruned: number;
  durationMs: number;
}

export async function runBackup(): Promise<BackupResult> {
  if (!backupClient) {
    throw new Error('Backup R2 bucket is not configured');
  }

  const startedAt = Date.now();
  const key = buildBackupKey(new Date(startedAt));
  const dbPath = process.env['DB_PATH'] ?? './data/wolf-cup.db';
  const snapshotPath = join(
    tmpdir(),
    `wolf-cup-backup-${startedAt}-${process.pid}.db`,
  );

  const client = createClient({ url: `file:${dbPath}` });
  try {
    const escaped = snapshotPath.replace(/'/g, "''");
    await client.execute(`VACUUM INTO '${escaped}'`);
  } finally {
    client.close();
  }

  try {
    const raw = await readFile(snapshotPath);
    const gzipped = gzipSync(raw, { level: 9 });

    await backupClient.send(
      new PutObjectCommand({
        Bucket: R2_BACKUP_BUCKET_NAME,
        Key: key,
        Body: gzipped,
        ContentType: 'application/gzip',
      }),
    );

    let pruned = 0;
    try {
      pruned = await pruneOldBackups();
    } catch (err) {
      console.error('Backup prune failed (non-fatal, upload succeeded):', err);
    }

    return {
      key,
      bytesUploaded: gzipped.byteLength,
      pruned,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await unlink(snapshotPath).catch(() => undefined);
  }
}

async function pruneOldBackups(): Promise<number> {
  if (!backupClient) return 0;

  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const res = await backupClient.send(
      new ListObjectsV2Command({
        Bucket: R2_BACKUP_BUCKET_NAME,
        Prefix: 'backups/',
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  const { deleteKeys } = planRetention(keys, new Date());
  for (const k of deleteKeys) {
    await backupClient.send(
      new DeleteObjectCommand({ Bucket: R2_BACKUP_BUCKET_NAME, Key: k }),
    );
  }
  return deleteKeys.length;
}
