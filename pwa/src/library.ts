export type LibraryTrackMeta = {
  id: string;
  title: string;
  originalName: string;
  createdAt: number;
  duration: number;
  codec: string;
  sampleRate: number;
  channels: number;
  bitrate: number | null;
  size: number;
  extractionMode: 'passthrough';
};

type LibraryAudioRecord = {
  id: string;
  blob: Blob;
};

const DB_NAME = 'video-audio-library';
const DB_VERSION = 1;
const META_STORE = 'tracks';
const AUDIO_STORE = 'audio';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

export function openLibraryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(AUDIO_STORE)) {
        database.createObjectStore(AUDIO_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('音源ライブラリを開けませんでした。'));
  });
}

export async function saveLibraryTrack(meta: LibraryTrackMeta, blob: Blob): Promise<void> {
  const database = await openLibraryDatabase();
  try {
    const transaction = database.transaction([META_STORE, AUDIO_STORE], 'readwrite');
    transaction.objectStore(META_STORE).put(meta);
    transaction.objectStore(AUDIO_STORE).put({ id: meta.id, blob } satisfies LibraryAudioRecord);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function listLibraryTracks(): Promise<LibraryTrackMeta[]> {
  const database = await openLibraryDatabase();
  try {
    const transaction = database.transaction(META_STORE, 'readonly');
    const tracks = await requestResult(transaction.objectStore(META_STORE).getAll() as IDBRequest<LibraryTrackMeta[]>);
    await transactionDone(transaction);
    return tracks.sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    database.close();
  }
}

export async function getLibraryAudio(id: string): Promise<Blob> {
  const database = await openLibraryDatabase();
  try {
    const transaction = database.transaction(AUDIO_STORE, 'readonly');
    const record = await requestResult(
      transaction.objectStore(AUDIO_STORE).get(id) as IDBRequest<LibraryAudioRecord | undefined>,
    );
    await transactionDone(transaction);
    if (!record?.blob) throw new Error('保存音源が見つかりません。');
    return record.blob;
  } finally {
    database.close();
  }
}

export async function renameLibraryTrack(id: string, title: string): Promise<void> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error('タイトルを入力してください。');

  const database = await openLibraryDatabase();
  try {
    const transaction = database.transaction(META_STORE, 'readwrite');
    const store = transaction.objectStore(META_STORE);
    const meta = await requestResult(store.get(id) as IDBRequest<LibraryTrackMeta | undefined>);
    if (!meta) {
      transaction.abort();
      throw new Error('対象の音源が見つかりません。');
    }
    store.put({ ...meta, title: normalizedTitle });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteLibraryTrack(id: string): Promise<void> {
  const database = await openLibraryDatabase();
  try {
    const transaction = database.transaction([META_STORE, AUDIO_STORE], 'readwrite');
    transaction.objectStore(META_STORE).delete(id);
    transaction.objectStore(AUDIO_STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}

export async function getStorageUsage(): Promise<{ usage: number | null; quota: number | null }> {
  if (!navigator.storage?.estimate) return { usage: null, quota: null };
  const estimate = await navigator.storage.estimate();
  return {
    usage: typeof estimate.usage === 'number' ? estimate.usage : null,
    quota: typeof estimate.quota === 'number' ? estimate.quota : null,
  };
}
