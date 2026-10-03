import type { ArtworkDocument } from './drawing';

const DATABASE = 'be-ve-artworks';
const STORE = 'artworks';
const BACKUPS = 'backups';
const VERSION = 2;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(BACKUPS)) {
        db.createObjectStore(BACKUPS, { keyPath: 'backupKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Không mở được thư viện tranh'));
  });
}

export async function saveArtwork(artwork: ArtworkDocument): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE, BACKUPS], 'readwrite');
    transaction.objectStore(STORE).put(artwork);
    const backupStore = transaction.objectStore(BACKUPS);
    backupStore.put({ backupKey: `${artwork.id}:${artwork.updatedAt}`, artwork });
    const backups = backupStore.getAll();
    backups.onsuccess = () => {
      const matching = (backups.result as { backupKey: string; artwork: ArtworkDocument }[])
        .filter((backup) => backup.artwork.id === artwork.id)
        .sort((a, b) => b.artwork.updatedAt - a.artwork.updatedAt);
      for (const old of matching.slice(3)) backupStore.delete(old.backupKey);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Không tự lưu được tranh'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Đã huỷ lưu tranh'));
  });
  db.close();
}

export async function listArtworks(): Promise<ArtworkDocument[]> {
  const db = await openDatabase();
  const results = await new Promise<ArtworkDocument[]>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as ArtworkDocument[]).sort((a, b) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(request.error ?? new Error('Không đọc được thư viện tranh'));
  });
  db.close();
  return results;
}

export async function listBackups(id: string): Promise<ArtworkDocument[]> {
  const db = await openDatabase();
  const results = await new Promise<ArtworkDocument[]>((resolve, reject) => {
    const request = db.transaction(BACKUPS, 'readonly').objectStore(BACKUPS).getAll();
    request.onsuccess = () => {
      const backups = request.result as { backupKey: string; artwork: ArtworkDocument }[];
      resolve(backups.filter((item) => item.artwork.id === id)
        .map((item) => item.artwork)
        .sort((a, b) => b.updatedAt - a.updatedAt));
    };
    request.onerror = () => reject(request.error ?? new Error('Không đọc được bản sao lưu'));
  });
  db.close();
  return results;
}

export async function deleteArtwork(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE, BACKUPS], 'readwrite');
    transaction.objectStore(STORE).delete(id);
    const backups = transaction.objectStore(BACKUPS);
    const request = backups.getAll();
    request.onsuccess = () => {
      for (const backup of request.result as { backupKey: string; artwork: ArtworkDocument }[]) {
        if (backup.artwork.id === id) backups.delete(backup.backupKey);
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Không xoá được tranh'));
  });
  db.close();
}
