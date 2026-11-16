// L'app Android è un guscio attorno al sito pubblicato: l'interfaccia si aggiorna da sola a ogni
// pubblicazione, l'APK cambia solo quando cambia la parte nativa. Serve perché pCloud dà i link ai
// brani solo ai programmi installati, non alle pagine web (vedi src/lib/native.ts).
//
// Per provarla contro il server di sviluppo: CAP_SERVER_URL=http://10.0.2.2:5173/?fake npx cap sync

import type { CapacitorConfig } from '@capacitor/cli'

const devUrl = process.env.CAP_SERVER_URL

const config: CapacitorConfig = {
  appId: 'io.github.robotlabs.musicx',
  appName: 'musicx',
  webDir: 'dist',
  server: {
    url: devUrl ?? 'https://robotlabs.github.io/musicx/',
    cleartext: devUrl?.startsWith('http://') ?? false,
  },
  android: {
    // Così il sito sa di girare dentro l'app anche prima che il ponte nativo sia pronto.
    appendUserAgent: 'musicx-android',
  },
}

export default config
