import { useSyncExternalStore } from 'react'

export interface Store<T> {
  get(): T
  set(next: T | ((prev: T) => T)): void
  subscribe(listener: () => void): () => void
}

/** Stato condiviso minimo: un valore, chi lo ascolta, niente altro. */
export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next
      if (Object.is(value, state)) return
      state = value
      listeners.forEach((listener) => listener())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function useStore<T>(store: Store<T>): T
/** Con `select` il componente si ridisegna solo quando cambia quel pezzo (deve essere un valore stabile). */
export function useStore<T, S>(store: Store<T>, select: (state: T) => S): S
export function useStore<T, S>(store: Store<T>, select?: (state: T) => S) {
  return useSyncExternalStore(store.subscribe, () => (select ? select(store.get()) : store.get()))
}
