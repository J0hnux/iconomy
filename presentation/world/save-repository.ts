import type { LocalSimulationSaveV1 } from "../../world/simulation/game-simulation";
import { deserializeLocalSave, serializeLocalSave } from "./local-save-storage";

/**
 * Browser persistence for the local simulation.
 *
 * IndexedDB is the primary store: the save is kept as a structured clone, so it
 * avoids both the JSON round-trip and the 5 MB UTF-16 ceiling that localStorage
 * imposes. localStorage remains a fallback for browsers that refuse IndexedDB,
 * and an existing localStorage save is migrated on first load so progress is
 * never lost. The persisted payload is the unchanged LocalSimulationSaveV1.
 */
export const localSaveKey = "openworld-economy-save-v1";
export const saveDatabaseName = "openworld-economy";
export const saveStoreName = "saves";
export const saveDatabaseVersion = 1;
export const saveRecordKey = "local";

export type SaveBackend = "indexeddb" | "localstorage" | "none";

export type SaveLoadResult = Readonly<{
  save: unknown | null;
  backend: SaveBackend;
  migrated: boolean;
}>;

const hasIndexedDb = () =>
  typeof indexedDB !== "undefined" && indexedDB !== null;

const hasLocalStorage = () => {
  try {
    return typeof window !== "undefined" && window.localStorage !== null;
  } catch {
    return false;
  }
};

function openSaveDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(saveDatabaseName, saveDatabaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(saveStoreName))
        database.createObjectStore(saveStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
    request.onblocked = () => reject(new Error("IndexedDB open was blocked."));
  });
}

function runTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(saveStoreName, mode);
    const request = operation(transaction.objectStore(saveStoreName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function readLocalStorageSave(): unknown | null {
  if (!hasLocalStorage()) return null;
  const serialized = window.localStorage.getItem(localSaveKey);
  if (!serialized) return null;
  return deserializeLocalSave(serialized);
}

/**
 * Loads the save, preferring IndexedDB and migrating any localStorage save
 * found on the way. Never throws: an unreadable store reports no save so the
 * caller can start a fresh settlement.
 */
export async function loadLocalSave(): Promise<SaveLoadResult> {
  if (hasIndexedDb()) {
    try {
      const database = await openSaveDatabase();
      try {
        const stored = await runTransaction(database, "readonly", (store) =>
          store.get(saveRecordKey),
        );
        if (stored !== undefined && stored !== null)
          return { save: stored, backend: "indexeddb", migrated: false };
        // Nothing in IndexedDB yet: adopt an existing localStorage save.
        const legacy = readLocalStorageSave();
        if (legacy !== null) {
          await runTransaction(database, "readwrite", (store) =>
            store.put(legacy, saveRecordKey),
          );
          if (hasLocalStorage()) window.localStorage.removeItem(localSaveKey);
          return { save: legacy, backend: "indexeddb", migrated: true };
        }
        return { save: null, backend: "indexeddb", migrated: false };
      } finally {
        database.close();
      }
    } catch {
      // Fall through to localStorage.
    }
  }
  try {
    const legacy = readLocalStorageSave();
    return {
      save: legacy,
      backend: hasLocalStorage() ? "localstorage" : "none",
      migrated: false,
    };
  } catch {
    return { save: null, backend: hasLocalStorage() ? "localstorage" : "none", migrated: false };
  }
}

/**
 * Writes the save, preferring IndexedDB. Throws when no store accepted it so
 * the caller can surface the failure instead of diverging silently.
 */
export async function storeLocalSave(
  save: LocalSimulationSaveV1,
): Promise<SaveBackend> {
  if (hasIndexedDb()) {
    try {
      const database = await openSaveDatabase();
      try {
        await runTransaction(database, "readwrite", (store) =>
          store.put(save, saveRecordKey),
        );
        return "indexeddb";
      } finally {
        database.close();
      }
    } catch {
      // Fall through to localStorage.
    }
  }
  if (!hasLocalStorage()) throw new Error("No browser storage is available.");
  window.localStorage.setItem(localSaveKey, serializeLocalSave(save));
  return "localstorage";
}

export async function clearLocalSave(): Promise<void> {
  if (hasIndexedDb()) {
    try {
      const database = await openSaveDatabase();
      try {
        await runTransaction(database, "readwrite", (store) =>
          store.delete(saveRecordKey),
        );
      } finally {
        database.close();
      }
    } catch {
      // Ignore: the localStorage removal below is still worth attempting.
    }
  }
  if (hasLocalStorage()) window.localStorage.removeItem(localSaveKey);
}
