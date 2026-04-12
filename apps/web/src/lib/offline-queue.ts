import { openDB, type IDBPDatabase } from 'idb';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueueEntry {
  id?: number; // auto-increment keyPath; undefined before add()
  roundId: number;
  groupId: number;
  holeNumber: number; // primary sort key for drain order
  scores: Array<{ playerId: number; grossScore: number; putts?: number }>;
  wolfDecision: {
    decision: 'alone' | 'partner' | 'blind_wolf' | null;
    partnerId: number | null;
    greenies: number[];
    polies: number[];
  } | null; // null when no wolf data to replay
  autoCalculateMoney: boolean;
  entryCode: string | null; // from session.entryCode
  timestamp: number; // Date.now() at enqueue time
}

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

const DB_NAME = 'wolf-cup-offline';
const STORE_NAME = 'score-queue';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

export async function enqueueScore(entry: Omit<QueueEntry, 'id'>): Promise<void> {
  const db = await getDB();
  await db.add(STORE_NAME, entry);
}

/** Returns all queued entries sorted by holeNumber ascending (drain order). */
export async function getQueue(): Promise<QueueEntry[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE_NAME)) as QueueEntry[];
  return all.sort((a, b) => a.holeNumber - b.holeNumber);
}

export async function removeFromQueue(id: number): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

export async function getQueueCount(roundId: number, groupId: number): Promise<number> {
  const db = await getDB();
  const all = (await db.getAll(STORE_NAME)) as QueueEntry[];
  return all.filter((e) => e.roundId === roundId && e.groupId === groupId).length;
}
