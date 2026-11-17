/** Cartella di pCloud che contiene tutta la musica. */
export const MUSIC_ROOT = '/rob/music'

/**
 * Client ID dell'app registrata su https://docs.pcloud.com/my_apps/ .
 * È un valore pubblico (flusso OAuth "token"), può stare nel repo.
 */
export const PCLOUD_CLIENT_ID: string = 'jDr9tOaTl7L'

/** L'unico Redirect URI che pCloud accetta per quell'app (lo vuole identico): altrove niente OAuth. */
export const PCLOUD_REDIRECT_URI = 'https://robotlabs.github.io/musicx/'

/**
 * Dove risponde rclone sul Mac (`rclone serve http pcloud:rob/music`, servizio launchd
 * com.roberto.rclone-music-http). Da lì passano i brani: pCloud non dà i link ai file alle app web.
 */
export const LOCAL_SOURCE = 'http://127.0.0.1:8620'

/** Estensioni trattate come musica. */
export const AUDIO_EXT = new Set([
  'mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav',
  'aif', 'aiff', 'wma', 'ape', 'wv', 'm4b',
])

/** Formati che Chrome suona da solo; gli altri passano dalla transcodifica mp3 di pCloud. */
export const NATIVE_EXT = new Set(['mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'm4b'])

/** L'indice della libreria si riaggiorna da solo quando è più vecchio di così. */
export const LIBRARY_MAX_AGE_MS = 12 * 60 * 60 * 1000
