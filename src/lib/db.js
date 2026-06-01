import { openDB } from 'idb';

const DB_NAME = 'void-transfer-db';
const DB_VERSION = 1;

let dbPromise;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sessions')) {
          const sessions = db.createObjectStore('sessions', {
            keyPath: 'sessionId',
          });
          sessions.createIndex('direction', 'direction');
          sessions.createIndex('status', 'status');
        }

        if (!db.objectStoreNames.contains('chunks')) {
          db.createObjectStore('chunks', {
            keyPath: ['sessionId', 'chunkIndex'],
          });
        }
      },
    });
  }

  return dbPromise;
}

export async function saveSession(session) {
  const db = await getDb();
  const previous = await db.get('sessions', session.sessionId);
  const next = {
    ...previous,
    ...session,
    updatedAt: Date.now(),
  };

  await db.put('sessions', next);
  return next;
}

export async function getSession(sessionId) {
  const db = await getDb();
  return db.get('sessions', sessionId);
}

export async function getSessions() {
  const db = await getDb();
  return db.getAll('sessions');
}

export async function getIncompleteSessions(direction) {
  const sessions = await getSessions();

  return sessions.filter((session) => {
    const incomplete = session.status !== 'complete' && session.status !== 'failed';
    return direction ? incomplete && session.direction === direction : incomplete;
  });
}

export async function saveChunk(sessionId, chunkIndex, data) {
  const db = await getDb();
  await db.put('chunks', {
    sessionId,
    chunkIndex,
    data,
    updatedAt: Date.now(),
  });
}

export async function getSessionChunks(sessionId) {
  const db = await getDb();
  const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
  const chunks = await db.getAll('chunks', range);

  return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
}

export async function deleteSession(sessionId) {
  const db = await getDb();
  const transaction = db.transaction(['sessions', 'chunks'], 'readwrite');
  await transaction.objectStore('sessions').delete(sessionId);

  let cursor = await transaction
    .objectStore('chunks')
    .openCursor(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]));

  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }

  await transaction.done;
}

export async function clearFailedSession(sessionId) {
  const session = await getSession(sessionId);

  if (session) {
    await saveSession({ ...session, status: 'failed' });
  }
}
