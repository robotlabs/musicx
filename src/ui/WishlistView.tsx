// "Da cercare": sul telefono si scrivono i brani da prendere da YouTube; sul Mac la stessa lista sta
// in "Da YouTube" e un clic lancia la ricerca (src/lib/wishlist.ts).

import { useEffect, useState, type FormEvent } from 'react'
import { libraryStore } from '../lib/library'
import { useStore } from '../lib/store'
import { addWish, loadWishes, removeWish, restoreWishes, wishStore, type Wish } from '../lib/wishlist'
import { Icon } from './icons'
import { Notice } from './parts'
import { toast } from './sheets'
import { errorText } from './text'

/**
 * Legge la lista all'apertura (prima la copia sul dispositivo, poi pCloud). Da pCloud solo con la
 * libreria pronta, che dice dov'è la cartella: ricaricando l'app su questa pagina arriva dopo.
 */
export function useWishes() {
  const root = useStore(libraryStore, (state) => state.library?.rootId)
  useEffect(() => restoreWishes(), [])
  useEffect(() => {
    if (root !== undefined) void loadWishes()
  }, [root])
  return useStore(wishStore)
}

/** Le voci della lista. Con `onPick` (sul Mac) un clic su una voce la cerca su YouTube. */
export function WishList({ onPick }: { onPick?: (wish: Wish) => void }) {
  const items = useStore(wishStore, (state) => state.items)
  const remove = (wish: Wish) => removeWish(wish.id).catch((error: unknown) => toast(errorText(error)))
  return (
    <ul className="rows wish-list">
      {items.map((wish) => (
        <li className="row" key={wish.id}>
          {onPick ? (
            <button className="row-main" onClick={() => onPick(wish)} title="Cerca su YouTube">
              <span className="row-icon">
                <Icon name="search" size={18} />
              </span>
              <span className="row-text">
                <span className="row-title">{wish.text}</span>
              </span>
            </button>
          ) : (
            <div className="row-main">
              <span className="row-icon">
                <Icon name="video" size={18} />
              </span>
              <span className="row-text">
                <span className="row-title">{wish.text}</span>
              </span>
            </div>
          )}
          <button className="icon-button" aria-label={`Togli "${wish.text}"`} title="Togli dalla lista" onClick={() => void remove(wish)}>
            <Icon name="close" />
          </button>
        </li>
      ))}
    </ul>
  )
}

export function WishlistView() {
  const { items, loaded, error } = useWishes()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function add(event: FormEvent) {
    event.preventDefault()
    const wanted = text.trim()
    if (!wanted) return
    setBusy(true)
    try {
      await addWish(wanted)
      setText('')
    } catch (problem) {
      toast(errorText(problem))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="view-head">
        <h1>Da cercare</h1>
        <p className="dim">Canzoni da prendere da YouTube: le scrivi qui e le ritrovi sul Mac, in "Da YouTube".</p>
      </header>
      <form className="yt-search" onSubmit={(event) => void add(event)}>
        <input
          type="text"
          value={text}
          placeholder="Titolo e artista"
          aria-label="Canzone da cercare"
          enterKeyHint="done"
          onChange={(event) => setText(event.target.value)}
        />
        <button className="pill primary" type="submit" disabled={busy || !text.trim()}>
          <Icon name="plus" size={16} /> Aggiungi
        </button>
      </form>
      {error && <p className="login-notice">{error}</p>}
      {!loaded && <Notice loading title="Leggo la lista…" />}
      {loaded && !items.length && !error && <Notice title="La lista è vuota" body="Scrivi titolo e artista di una canzone che vuoi scaricare." />}
      <WishList />
    </>
  )
}
