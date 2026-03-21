// ---------------------------------------------------------------------------
// Cloudflare R2 client (S3-compatible)
// ---------------------------------------------------------------------------

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const R2_ACCOUNT_ID = process.env['R2_ACCOUNT_ID'] ?? '';
const R2_ACCESS_KEY_ID = process.env['R2_ACCESS_KEY_ID'] ?? '';
const R2_SECRET_ACCESS_KEY = process.env['R2_SECRET_ACCESS_KEY'] ?? '';
const R2_BUCKET_NAME = process.env['R2_BUCKET_NAME'] ?? '';
const R2_PUBLIC_URL = process.env['R2_PUBLIC_URL'] ?? '';

export const r2Configured = Boolean(
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME,
);

const s3 = r2Configured
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  if (!s3) throw new Error('R2 is not configured');
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : key;
}

export async function deleteFromR2(key: string): Promise<void> {
  if (!s3) throw new Error('R2 is not configured');
  await s3.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    }),
  );
}
