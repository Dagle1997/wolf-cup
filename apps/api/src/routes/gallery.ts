import { Hono } from 'hono';
import { eq, desc, sql, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { db } from '../db/index.js';
import { galleryPhotos, rounds, players, roundPlayers } from '../db/schema.js';
import { uploadToR2, r2Configured } from '../lib/r2-client.js';

const app = new Hono();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  return map[mime] ?? 'jpg';
}

// ---------------------------------------------------------------------------
// POST /gallery/upload — upload a photo
// ---------------------------------------------------------------------------

app.post('/gallery/upload', async (c) => {
  if (!r2Configured) {
    return c.json({ error: 'STORAGE_NOT_CONFIGURED' }, 503);
  }

  const formData = await c.req.formData();
  const file = formData.get('photo');
  const caption = formData.get('caption');

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'MISSING_PHOTO' }, 400);
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return c.json({ error: 'INVALID_FILE_TYPE', allowed: [...ALLOWED_TYPES] }, 400);
  }

  if (file.size > MAX_FILE_SIZE) {
    return c.json({ error: 'FILE_TOO_LARGE', maxBytes: MAX_FILE_SIZE }, 400);
  }

  // Find active round (if any)
  const [activeRound] = await db
    .select({
      id: rounds.id,
      entryCodeHash: rounds.entryCodeHash,
    })
    .from(rounds)
    .where(eq(rounds.status, 'active'))
    .limit(1);

  const roundId = activeRound?.id ?? null;

  // Try to resolve player from entry code
  let playerId: number | null = null;
  const entryCode = c.req.header('x-entry-code');
  if (entryCode && activeRound?.entryCodeHash) {
    const codeValid = await bcrypt.compare(entryCode, activeRound.entryCodeHash);
    if (codeValid) {
      // We know they're in this round but can't identify which player from code alone
      // Entry code is shared across the group, so player identity isn't resolvable this way
      // Leave playerId null — could add player selection in frontend later
    }
  }

  // Upload to R2
  const year = new Date().getFullYear();
  const folder = roundId ? `round-${roundId}` : 'general';
  const ext = extFromMime(file.type);
  const r2Key = `photos/${year}/${folder}/${randomUUID()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const publicUrl = await uploadToR2(r2Key, buffer, file.type);

  const now = Date.now();
  const [inserted] = await db
    .insert(galleryPhotos)
    .values({
      roundId,
      playerId,
      r2Key,
      publicUrl,
      originalFilename: file.name ?? `photo.${ext}`,
      mimeType: file.type,
      fileSize: file.size,
      caption: typeof caption === 'string' && caption.trim() ? caption.trim() : null,
      createdAt: now,
    })
    .returning({ id: galleryPhotos.id });

  return c.json({
    id: inserted!.id,
    publicUrl,
    roundId,
  });
});

// ---------------------------------------------------------------------------
// GET /gallery — list all photos
// ---------------------------------------------------------------------------

app.get('/gallery', async (c) => {
  const roundIdParam = c.req.query('roundId');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);
  const offset = Number(c.req.query('offset') ?? 0);

  const conditions = roundIdParam
    ? and(eq(galleryPhotos.roundId, Number(roundIdParam)))
    : undefined;

  const [photoRows, countResult] = await Promise.all([
    db
      .select({
        id: galleryPhotos.id,
        roundId: galleryPhotos.roundId,
        publicUrl: galleryPhotos.publicUrl,
        caption: galleryPhotos.caption,
        createdAt: galleryPhotos.createdAt,
        playerName: players.name,
        scheduledDate: rounds.scheduledDate,
      })
      .from(galleryPhotos)
      .leftJoin(players, eq(players.id, galleryPhotos.playerId))
      .leftJoin(rounds, eq(rounds.id, galleryPhotos.roundId))
      .where(conditions)
      .orderBy(desc(galleryPhotos.createdAt))
      .limit(limit)
      .offset(offset),

    db
      .select({ count: sql<number>`count(*)` })
      .from(galleryPhotos)
      .where(conditions),
  ]);

  return c.json({
    photos: photoRows.map((p) => ({
      id: p.id,
      roundId: p.roundId,
      publicUrl: p.publicUrl,
      caption: p.caption,
      createdAt: p.createdAt,
      playerName: p.playerName,
      roundDate: p.scheduledDate,
    })),
    total: countResult[0]?.count ?? 0,
  });
});

// ---------------------------------------------------------------------------
// GET /gallery/rounds/:roundId — photos for a specific round
// ---------------------------------------------------------------------------

app.get('/gallery/rounds/:roundId', async (c) => {
  const roundId = Number(c.req.param('roundId'));

  const photoRows = await db
    .select({
      id: galleryPhotos.id,
      publicUrl: galleryPhotos.publicUrl,
      caption: galleryPhotos.caption,
      createdAt: galleryPhotos.createdAt,
      playerName: players.name,
    })
    .from(galleryPhotos)
    .leftJoin(players, eq(players.id, galleryPhotos.playerId))
    .where(eq(galleryPhotos.roundId, roundId))
    .orderBy(desc(galleryPhotos.createdAt));

  return c.json({
    photos: photoRows.map((p) => ({
      id: p.id,
      publicUrl: p.publicUrl,
      caption: p.caption,
      createdAt: p.createdAt,
      playerName: p.playerName,
    })),
    count: photoRows.length,
  });
});

export default app;
