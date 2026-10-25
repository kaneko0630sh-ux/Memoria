// IndexedDB の薄いラッパー。すべてのストアは id をキーにする
// chars / worlds / plots は v1 形式の移行元としてのみ残している

const NAME = 'memoria';
const VERSION = 2;
const STORES = ['kv', 'stories', 'chats', 'chars', 'worlds', 'plots'];

let db = null;

function run(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
// iPhone でバックグラウンドから戻ると接続が切れていることがある（Connection to Indexed Database server lost）。開き直して1回だけやり直す
async function tx(store, mode, fn) {
  if (!db) await DB.open();
  try { return await run(store, mode, fn); } catch (e) {
    if (!['InvalidStateError', 'UnknownError', 'TransactionInactiveError'].includes(e?.name) && !/connection|closed|lost/i.test(e?.message || '')) throw e;
    db = null;
    await DB.open();
    return run(store, mode, fn);
  }
}

export const DB = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VERSION);
      r.onupgradeneeded = () => {
        for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => { db = r.result; db.onclose = () => { db = null; }; db.onversionchange = () => { db.close(); db = null; }; res(); };
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
