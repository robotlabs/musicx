// L'app Android: l'interfaccia è la stessa del sito, ma sta dentro l'APK, così si apre anche senza
// rete (per i brani scaricati). Quando c'è rete scarica da sola la versione nuova del sito
// (src/lib/appUpdate.ts): l'APK va rifatto solo quando cambia la parte nativa. Serve perché pCloud
// dà i link ai brani solo ai programmi installati, non alle pagine web (vedi src/lib/native.ts).
//
// I file locali sono serviti come https://robotlabs.github.io: stessa origine del sito che l'app
// caricava prima, quindi accesso, coda e libreria salvati restano.
//
// Per provarla contro il server di sviluppo: CAP_SERVER_URL=http://10.0.2.2:5173/?fake npx cap sync

import type { CapacitorConfig } from '@capacitor/cli'

const devUrl = process.env.CAP_SERVER_URL

const config: CapacitorConfig = {
  appId: 'io.github.robotlabs.musicx',
  appName: 'musicx',
  webDir: 'dist',
  server: devUrl
    ? { url: devUrl, cleartext: devUrl.startsWith('http://') }
    : { hostname: 'robotlabs.github.io', androidScheme: 'https' },
  android: {
    // Così il sito sa di girare dentro l'app anche prima che il ponte nativo sia pronto.
    appendUserAgent: 'musicx-android',
  },
}

export default config
