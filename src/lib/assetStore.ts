import type { NativeFile } from '../domain/preset';

const DB_NAME = 'framebase-local-assets';
const STORE = 'native-files';
const DB_VERSION = 2;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : database.createObjectStore(STORE, { keyPath: 'id' });
      if (!store.indexNames.contains('presetId')) store.createIndex('presetId', 'presetId', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir la biblioteca local.'));
  });
}

interface StoredFile extends Omit<NativeFile, 'bytes'> {
  id: string;
  presetId: string;
  bytes: ArrayBuffer;
}

export async function saveNativeFiles(presetId: string, files: NativeFile[]): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const database = await openDatabase();
  const transaction = database.transaction(STORE, 'readwrite');
  const store = transaction.objectStore(STORE);
  const previous = store.indexNames.contains('presetId') ? store.index('presetId') : null;
  if (previous) {
    const request = previous.openKeyCursor(IDBKeyRange.only(presetId));
    request.onsuccess = () => {
      if (request.result) {
        store.delete(request.result.primaryKey);
        request.result.continue();
      }
    };
  } else {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      if (cursor.result) {
        if ((cursor.result.value as StoredFile).presetId === presetId) cursor.result.delete();
        cursor.result.continue();
      }
    };
  }
  for (const file of files) {
    store.put({ ...file, id: `${presetId}:${file.path}`, presetId, bytes: file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) });
  }
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('No se pudieron guardar los recursos.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Se canceló el guardado de recursos.'));
  });
  database.close();
}

export async function readNativeFiles(presetId: string): Promise<NativeFile[]> {
  if (typeof indexedDB === 'undefined') return [];
  const database = await openDatabase();
  const transaction = database.transaction(STORE, 'readonly');
  const request = transaction.objectStore(STORE).getAll();
  const rows = await new Promise<StoredFile[]>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as StoredFile[]).filter((file) => file.presetId === presetId));
    request.onerror = () => reject(request.error ?? new Error('No se pudieron leer los recursos.'));
  });
  database.close();
  return rows.map(({ path, bytes, role }) => ({ path, bytes: new Uint8Array(bytes), role }));
}

export async function deleteNativeFiles(presetId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const files = await readNativeFiles(presetId);
  const database = await openDatabase();
  const transaction = database.transaction(STORE, 'readwrite');
  const store = transaction.objectStore(STORE);
  for (const file of files) store.delete(`${presetId}:${file.path}`);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('No se pudieron borrar los recursos.'));
  });
  database.close();
}
