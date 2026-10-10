import type { Seen } from "./seen";
import type { Mark } from "./shared/report";

/** A draft as this tab keeps it across page loads. */
export type Kept = {
  saved: number;
  note: string;
  category: string | undefined;
  shots: { image: Blob; marks: Mark[]; seen: Seen }[];
};

// Bytes, not Blobs: WebKit cannot store a Blob in a private window's IndexedDB.
type Stored = Omit<Kept, "shots"> & {
  shots: { image: ArrayBuffer; type: string; marks: Mark[]; seen: Seen }[];
};

/** A draft older than this is gone: the tab that kept it was most likely closed. */
export const KEPT_FOR = 86_400_000;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("visual-feedback", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("drafts", mode);
      const request = work(transaction.objectStore("drafts"));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

// Lets go of drafts older than KEPT_FOR, such as one a closed tab left behind.
function sweepIn(store: IDBObjectStore): void {
  const cursors = store.openCursor();
  cursors.onsuccess = () => {
    const cursor = cursors.result;
    if (!cursor) return;
    if ((cursor.value as Stored).saved < Date.now() - KEPT_FOR) cursor.delete();
    cursor.continue();
  };
}

export function sweep(): Promise<unknown> {
  return run("readwrite", (store) => {
    sweepIn(store);
    return undefined;
  });
}

/** Stores the draft under `id`, and lets go of old ones. */
export async function keep(id: string, draft: Kept): Promise<unknown> {
  const shots = [];
  for (const { image, ...shot } of draft.shots) {
    shots.push({ ...shot, image: await image.arrayBuffer(), type: image.type });
  }
  const stored: Stored = { ...draft, shots };
  return run("readwrite", (store) => {
    store.put(stored, id);
    sweepIn(store);
    return undefined;
  });
}

export async function read(id: string): Promise<Kept | undefined> {
  const stored = await run<Stored>("readonly", (store) => store.get(id));
  if (!stored) return undefined;
  const shots = stored.shots.map(({ image, type, ...shot }) => ({
    ...shot,
    image: new Blob([image], { type }),
  }));
  return { ...stored, shots };
}

export function forget(id: string): Promise<unknown> {
  return run("readwrite", (store) => store.delete(id));
}
