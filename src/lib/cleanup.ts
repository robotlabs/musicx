// "Pulisci tutto": il dispositivo torna come appena installato, ma si resta dentro pCloud.

import { clearAllAudio } from './audioStore'
import { forgetPins } from './downloads'
import { clearLibrary, initLibrary } from './library'
import { refreshPlaylists, resetPlaylists } from './playlists'

/** Toglie download, brani precaricati e la copia di libreria e playlist; poi le rilegge da pCloud. */
export async function cleanEverything() {
  forgetPins()
  await clearAllAudio()
  resetPlaylists()
  await clearLibrary()
  void initLibrary()
  void refreshPlaylists()
}

/** All'uscita dall'account: via anche i brani salvati (erano di quell'account). */
export async function forgetSavedMusic() {
  forgetPins()
  await clearAllAudio()
}
