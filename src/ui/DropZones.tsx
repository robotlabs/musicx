// Riquadri che compaiono in cima alle playlist mentre si trascina: nuova playlist (con dei brani),
// nuovo gruppo o fuori dai gruppi (con una playlist).

import type { useDropTargets } from './drag'
import { Icon, type IconName } from './icons'
import { moveToGroup, newGroupWith } from './playlistActions'

export function DropZones({
  targets,
  newPlaylistWith,
}: {
  targets: ReturnType<typeof useDropTargets>
  /** Se data, con dei brani compare "Nuova playlist". */
  newPlaylistWith?: (ids: number[], label: string) => void
}) {
  const { dragged, over, target } = targets
  if (!dragged) return null

  const zone = (key: string, icon: IconName, label: string, onDrop: () => void) => (
    <div key={key} className={`drop-zone${over === key ? ' drop-over' : ''}`} {...target(key, onDrop)}>
      <Icon name={icon} size={16} /> {label}
    </div>
  )

  const zones =
    dragged.kind === 'tracks'
      ? newPlaylistWith
        ? [zone('new-playlist', 'plus', 'Nuova playlist', () => newPlaylistWith(dragged.ids, dragged.label))]
        : []
      : [
          zone('new-group', 'folderPlus', 'Nuovo gruppo', () => void newGroupWith([dragged.id])),
          dragged.group && zone('ungroup', 'close', 'Fuori dai gruppi', () => moveToGroup([dragged.id], null)),
        ]
  return zones.length ? <div className="drop-zones">{zones}</div> : null
}
