let namespace = 'musicx'

/** La modalità finta usa un altro spazio dei nomi, così non sporca i dati veri. */
export function setNamespace(next: string) {
  namespace = next
}

/** Chiave per localStorage / IndexedDB. */
export const storageKey = (name: string) => `${namespace}.${name}`
