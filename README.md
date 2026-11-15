# musicx

Player musicale personale. Una web app installabile (PWA) che legge la musica direttamente da
pCloud (`/rob/music`): niente server, niente rclone, niente Mac acceso. Sul Mac e su Android si
installa da Chrome e si usa come un'app.

- **Libreria**: tutto l'albero di `/rob/music` letto in una chiamata e salvato nel browser.
  Navigazione per cartelle e ricerca istantanea su titolo, artista, album e nome cartella.
- **Playlist**: sono le playlist native di pCloud (API `collection_*`), quindi le stesse su ogni
  dispositivo e visibili anche nell'app ufficiale di pCloud. Riordino trascinando, import dei
  vecchi `.m3u`.
- **Lettore**: coda, casuale, ripeti, ripresa da dove eri rimasto. I formati che Chrome non suona
  (wma, alac…) passano dalla transcodifica mp3 di pCloud. A schermo spento e con i tasti
  multimediali funziona grazie alla Media Session di Chrome.

## Sviluppo

```bash
npm install
npm run dev          # http://localhost:5173 (se è occupata, Vite passa alla porta libera successiva)
npm test
npm run build
```

`http://localhost:5173/?fake` apre l'app con un pCloud finto (libreria inventata, brani sintetici,
playlist in memoria): serve per lavorare sull'interfaccia senza account. `?fake=30` fa brani da 30
secondi. Il codice finto non entra nella build di produzione.

## Configurazione pCloud (una volta sola)

1. Su <https://docs.pcloud.com/my_apps/> crea un'app con accesso a **tutto** il drive (non solo
   alla cartella dell'app).
2. Redirect URI da registrare: `https://robotlabs.github.io/musicx/` e, per lo sviluppo,
   `http://localhost:5173/`.
3. Scrivi il Client ID in `src/config.ts` (`PCLOUD_CLIENT_ID`). È pubblico per costruzione: il
   flusso OAuth "token" non usa segreti.

Il token resta solo nel browser del dispositivo (localStorage). "Esci da pCloud" nel menu ⋯ lo
cancella.

## Pubblicazione

Ogni push su `main` pubblica `dist/` su GitHub Pages tramite `.github/workflows/pages.yml`
(il job parte solo se il repo è pubblico).

## Scelte da non rifare

- Niente mount di pCloud sul Mac (pCloud Drive, rclone nfsmount, FUSE, WebDAV): bloccavano Finder
  e VLC in modo irrecuperabile. Il vecchio setup basato su `rclone serve http` è in `legacy/`.
- Niente Electron / React Native / Capacitor: Chrome gestisce da solo audio in background,
  notifica e lock screen per una PWA installata.

## Struttura

- `src/lib/pcloud.ts` – chiamate all'API pCloud (unico punto di contatto con la rete)
- `src/lib/library.ts` – indice della libreria, ricerca, cache in IndexedDB
- `src/lib/player.ts` – elemento audio, coda, Media Session, tentativi di recupero
- `src/lib/queue.ts` – logica della coda (pura, testata)
- `src/lib/playlists.ts` – playlist pCloud, modifiche in fila una alla volta
- `src/lib/m3u.ts` – import dei vecchi `.m3u`
- `src/lib/fake.ts` – pCloud finto per lo sviluppo
- `src/ui/` – interfaccia React
