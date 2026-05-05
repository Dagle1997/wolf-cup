/**
 * T7-4 r2-client unit tests. Mocks @aws-sdk/client-s3 and the presigner so
 * the suite runs without R2 network access. Real-R2 behavior is verified
 * via the manual smoke checklist in the story file (Definition of Done).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ---- Mocks ----------------------------------------------------------------

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class MockCommand {
    constructor(public readonly input: unknown) {}
  }
  return {
    S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
    PutObjectCommand: MockCommand,
    GetObjectCommand: MockCommand,
    DeleteObjectCommand: MockCommand,
  };
});

const getSignedUrlMock = vi.fn();

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}));

// ---- Helpers --------------------------------------------------------------

async function loadClientWithEnv(envOverrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) {
      delete (process.env as Record<string, string | undefined>)[k];
    } else {
      process.env[k] = v;
    }
  }
  return await import('./r2-client.js');
}

const ALL_R2_ENVS = {
  R2_ACCOUNT_ID: 'acct-123',
  R2_ACCESS_KEY_ID: 'AK-XYZ',
  R2_SECRET_ACCESS_KEY: 'super-secret',
  R2_BUCKET_NAME: 'wolf-cup-bucket',
};

// ---- Suite ----------------------------------------------------------------

describe('r2-client — configuration', () => {
  afterEach(() => {
    sendMock.mockReset();
    getSignedUrlMock.mockReset();
  });

  test('r2Configured === false when any env is missing', async () => {
    for (const omitted of Object.keys(ALL_R2_ENVS)) {
      const overrides: Record<string, string | undefined> = { ...ALL_R2_ENVS };
      overrides[omitted] = undefined;
      const mod = await loadClientWithEnv(overrides);
      expect(
        mod.r2Configured,
        `r2Configured should be false when ${omitted} is missing`,
      ).toBe(false);
    }
  });

  test('r2Configured === true when all four envs are non-empty', async () => {
    const mod = await loadClientWithEnv(ALL_R2_ENVS);
    expect(mod.r2Configured).toBe(true);
  });

  test('upload/delete/sign throw when R2 is not configured', async () => {
    const mod = await loadClientWithEnv({
      ...ALL_R2_ENVS,
      R2_BUCKET_NAME: undefined,
    });
    await expect(
      mod.uploadToR2('k', Buffer.from(''), 'image/jpeg'),
    ).rejects.toThrow(/not configured/i);
    await expect(mod.deleteFromR2('k')).rejects.toThrow(/not configured/i);
    await expect(mod.getSignedDownloadUrl('k')).rejects.toThrow(/not configured/i);
  });
});

describe('r2-client — operations', () => {
  let mod: typeof import('./r2-client.js');

  beforeEach(async () => {
    sendMock.mockReset();
    getSignedUrlMock.mockReset();
    mod = await loadClientWithEnv(ALL_R2_ENVS);
  });

  test('uploadToR2 calls S3Client.send with PutObjectCommand shape', async () => {
    sendMock.mockResolvedValue({});
    await mod.uploadToR2(
      'tournament/events/e-1/abc.jpg',
      Buffer.from('hello'),
      'image/jpeg',
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = sendMock.mock.calls[0]![0] as { input: { Bucket: string; Key: string; ContentType: string; Body: unknown } };
    expect(cmd.input.Bucket).toBe('wolf-cup-bucket');
    expect(cmd.input.Key).toBe('tournament/events/e-1/abc.jpg');
    expect(cmd.input.ContentType).toBe('image/jpeg');
    expect(cmd.input.Body).toBeInstanceOf(Buffer);
  });

  test('deleteFromR2 calls S3Client.send with DeleteObjectCommand shape', async () => {
    sendMock.mockResolvedValue({});
    await mod.deleteFromR2('tournament/events/e-1/abc.jpg');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = sendMock.mock.calls[0]![0] as { input: { Bucket: string; Key: string } };
    expect(cmd.input.Bucket).toBe('wolf-cup-bucket');
    expect(cmd.input.Key).toBe('tournament/events/e-1/abc.jpg');
  });

  test('getSignedDownloadUrl forwards the GetObjectCommand to the presigner', async () => {
    getSignedUrlMock.mockResolvedValue(
      'https://example.r2.cloudflarestorage.com/key?X-Amz-Signature=abc&X-Amz-Expires=3600',
    );
    const url = await mod.getSignedDownloadUrl('tournament/events/e-1/abc.jpg');
    expect(url).toContain('X-Amz-Signature');
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const [, getCmd, opts] = getSignedUrlMock.mock.calls[0]! as [
      unknown,
      { input: { Bucket: string; Key: string } },
      { expiresIn: number },
    ];
    expect(getCmd.input.Bucket).toBe('wolf-cup-bucket');
    expect(getCmd.input.Key).toBe('tournament/events/e-1/abc.jpg');
    expect(opts.expiresIn).toBe(3600);
  });

  test('getSignedDownloadUrl honours custom TTL', async () => {
    getSignedUrlMock.mockResolvedValue('https://example/?X-Amz-Expires=60');
    await mod.getSignedDownloadUrl('k', 60);
    const [, , opts] = getSignedUrlMock.mock.calls[0]! as [
      unknown,
      unknown,
      { expiresIn: number },
    ];
    expect(opts.expiresIn).toBe(60);
  });
});
