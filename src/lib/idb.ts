// IndexedDB usato come semplice chiave → valore (l'indice della libreria è troppo grande per localStorage).

const DB_NAME = 'musicx'
const STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = action(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export const idbGet = <T>(key: string) => run<T | undefined>('readonly', (store) => store.get(key))
export const idbSet = (key: string, value: unknown) => run('readwrite', (store) => store.put(value, key))
export const idbDel = (key: string) => run('readwrite', (store) => store.delete(key))
