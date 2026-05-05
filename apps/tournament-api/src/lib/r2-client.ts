/* PORTED from apps/api/src/lib/r2-client.ts @ commit 2bb76900dee9c2b6221bc6fd4430987d700378ee (dated 2026-05-05).
   R2 bucket shared with Wolf Cup; tournament uses key prefix 'tournament/events/{eventId}/'
   per arch D5-10. Scope: upload, delete, signed-GET. Wolf Cup's R2_PUBLIC_URL fast-path
   is intentionally NOT ported — tournament uses presigned GETs for all reads. */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';

export const r2Configured: boolean = Boolean(
  env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET_NAME,
);

const s3: S3Client | null = r2Configured
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    })
  : null;

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  if (!s3) throw new Error('R2 is not configured');
  await s3.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME!,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteFromR2(key: string): Promise<void> {
  if (!s3) throw new Error('R2 is not configured');
  await s3.send(
    new DeleteObjectCommand({
      Bucket: env.R2_BUCKET_NAME!,
      Key: key,
    }),
  );
}

/**
 * Generate a short-lived presigned GET URL for an R2 object. Default TTL
 * is 3600s (1h); the gallery list route uses this for every photo and the
 * client re-fetches when the tab refocuses (TanStack Query
 * `refetchOnWindowFocus: true`).
 *
 * Wolf Cup's R2 access pattern is `R2_PUBLIC_URL/{key}` (public bucket via
 * a custom dev URL). Tournament intentionally avoids that path so the
 * bucket-write credential is the only credential the bucket sees per
 * read — forward-compatible with eventually moving tournament's prefix to
 * a private bucket without an API contract change.
 */
// SigV4 presigned URLs cap out at 7 days (604_800 s). Reject anything
// outside [60 s, 604_800 s] before handing to the SDK so a programming bug
// (NaN, negative, fractional) surfaces here rather than as a confusing
// AWS-side rejection.
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_TTL_SECONDS = 60;

export async function getSignedDownloadUrl(
  key: string,
  ttlSeconds = 3600,
): Promise<string> {
  if (!s3) throw new Error('R2 is not configured');
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < MIN_TTL_SECONDS ||
    ttlSeconds > MAX_TTL_SECONDS
  ) {
    throw new Error(
      `getSignedDownloadUrl: ttlSeconds must be an integer in [${MIN_TTL_SECONDS}, ${MAX_TTL_SECONDS}], got ${ttlSeconds}`,
    );
  }
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: env.R2_BUCKET_NAME!,
      Key: key,
    }),
    { expiresIn: ttlSeconds },
  );
}
