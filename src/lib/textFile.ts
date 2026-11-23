// Il testo di un file della cartella della musica (playlist da importare, lista "Da cercare"):
// nell'app dal lato nativo, sul Mac da rclone; altrove pCloud di solito non dà il file a una pagina web.

import { LOCAL_SOURCE } from '../config'
import { localSourceUp, whyNoFiles } from './localSource'
import { isNativeApp, nativeGetBytes } from './native'
import { fileLink, type RawMeta } from './pcloud'

export async function readMusicFile(file: RawMeta): Promise<string> {
  if (isNativeApp) return new TextDecoder().decode(await nativeGetBytes(await fileLink(file.fileid!, true), 60_000))
  if (await localSourceUp()) {
    const response = await fetch(`${LOCAL_SOURCE}/${encodeURIComponent(file.name)}`)
    if (!response.ok) throw new Error(`Il file non si legge (${response.status}).`)
    return response.text()
  }
  // Altrove pCloud di solito non dà il link a una pagina web (sì nella modalità finta di sviluppo).
  try {
    const response = await fetch(await fileLink(file.fileid!, true))
    if (response.ok) return await response.text()
  } catch {
    // Si spiega sotto perché non si può.
  }
  throw new Error(await whyNoFiles())
}

