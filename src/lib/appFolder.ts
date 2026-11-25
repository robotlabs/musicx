// Le cartelle dell'app su pCloud, dentro music/.musicx: la libreria salta le cartelle col punto,
// quindi lì si possono tenere dati ("Da cercare", i tag) senza che compaiano tra la musica.

import { libraryStore } from './library'
import { createFolder, listFolder } from './pcloud'

/**
 * La cartella `path` sotto la radice della musica (es. ['.musicx', 'tag']). Con `create` la crea se
 * manca; senza, se manca restituisce null.
 */
export async function appFolder(path: string[], create: boolean): Promise<number | null> {
  const root = libraryStore.get().library?.rootId
  if (root === undefined) throw new Error('La libreria non è ancora caricata.')
  let id = root
  for (const name of path) {
    if (create) id = (await createFolder(id, name)).folderid!
    else {
      const found = (await listFolder(id, true)).contents?.find((entry) => entry.isfolder && entry.name === name)
      if (!found) return null
      id = found.folderid!
    }
  }
  return id
}

// Nei nomi delle cartelle pCloud non vuole "/" né "\": diventano barre simili, e tornano indietro.
export const toFolderName = (text: string, max = 200) =>
  text.replace(/\//g, '∕').replace(/\\/g, '⧵').replace(/\s+/g, ' ').trim().slice(0, max)
export const fromFolderName = (name: string) => name.replace(/∕/g, '/').replace(/⧵/g, '\\')
