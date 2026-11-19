// La stella dei preferiti: nella riga del brano (col mouse si vede passandoci sopra, piena resta
// sempre), nel lettore e come voce del menu ⋯ (sul telefono).

import type { MouseEvent } from 'react'
import type { QItem } from '../lib/queue'
import { starredStore, toggleStar } from '../lib/starred'
import { useStore } from '../lib/store'
import { Icon } from './icons'
import { toast, type MenuItem } from './sheets'
import { errorText } from './text'

function flip(item: QItem) {
  toggleStar(item).catch((error: unknown) => toast(errorText(error)))
}

export function StarButton({ item, size = 18, className = '' }: { item: QItem; size?: number; className?: string }) {
  const on = useStore(starredStore, (state) => state.ids.has(item.id))
  const click = (event: MouseEvent) => {
    event.stopPropagation()
    flip(item)
  }
  return (
    <button
      className={`icon-button star-button${on ? ' on' : ''} ${className}`.trim()}
      aria-label={on ? `Togli ${item.title} dai preferiti` : `Aggiungi ${item.title} ai preferiti`}
      aria-pressed={on}
      title={on ? 'Togli dai preferiti' : 'Aggiungi ai preferiti'}
      onClick={click}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Icon name={on ? 'starred' : 'star'} size={size} />
    </button>
  )
}

export function starMenuItem(item: QItem): MenuItem {
  const on = starredStore.get().ids.has(item.id)
  return on
    ? { label: 'Togli dai preferiti', icon: 'starred', onSelect: () => flip(item) }
    : { label: 'Aggiungi ai preferiti', icon: 'star', onSelect: () => flip(item) }
}
