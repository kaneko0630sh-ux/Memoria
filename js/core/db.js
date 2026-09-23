// IndexedDB の薄いラッパー。すべてのストアは id をキーにする
// chars / worlds / plots は v1 形式の移行元としてのみ残している

const NAME = 'memoria';
const VERSION = 2;
const STORES = ['kv', 'stories', 'chats', 'chars', 'worlds', 'plots'];

let db = null;

function tx(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const DB = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VERSION);
      r.onupgradeneeded = () => {
        for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => { db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  all: s => tx(s, 'readonly', st => st.getAll()),
  get: (s, id) => tx(s, 'readonly', st => st.get(id)),
  put: (s, o) => tx(s, 'readwrite', st => st.put(o)),
  del: (s, id) => tx(s, 'readwrite', st => st.delete(id)),
  clear: s => tx(s, 'readwrite', st => st.clear()),
  stores: STORES,
};
