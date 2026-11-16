# musicx

Player musicale personale. Una web app (PWA) che legge libreria e playlist direttamente da pCloud
(`/rob/music`). Sul Mac si installa da Chrome; su Android c'è un'app che è solo un guscio attorno
allo stesso sito.

**Da dove arriva l'audio.** pCloud non dà i link ai file alle pagine web: `getfilelink`,
`getaudiolink` e tutti gli altri metodi che danno link rispondono "Invalid link referer" a chi non
è pcloud.com, anche senza Referer. Quindi:

- **Mac**: i brani passano da rclone, il servizio launchd `com.roberto.rclone-music-http`
  (`rclone serve http pcloud:rob/music` su `127.0.0.1:8620`). La prima volta Chrome chiede il
  permesso di accedere ai servizi del computer ("rete locale"). Se rclone smette di rispondere
  perché pCloud gli ha revocato l'accesso: `rclone config reconnect pcloud:` e poi
  `launchctl kickstart -k gui/$(id -u)/com.roberto.rclone-music-http`.
- **Android**: l'app musicx (Capacitor) carica il sito pubblicato e chiede i link dal lato nativo
  (`CapacitorHttp`, senza Origin né Referer). Il link vale per l'IP che l'ha chiesto, cioè il
  telefono, e l'`<audio>` della pagina lo suona. Notifica, schermata di blocco e musica a schermo
  spento li fa `@capgo/capacitor-media-session`. In Chrome sul telefono i brani non suonano: il
  menu ⋯ offre di scaricare l'app.

## App Android

Si scarica da <https://github.com/robotlabs/musicx/releases/latest/download/musicx.apk> e si
installa una volta (Android chiede di consentire le app da origine sconosciuta). L'interfaccia
arriva dal sito, quindi si aggiorna da sola a ogni pubblicazione; l'APK va rifatto solo quando
cambia la parte nativa (`android/`, `capacitor.config.ts`, dipendenze): lo fa
`.github/workflows/android.yml`, che lo firma sempre con la stessa chiave (segreti
`MUSICX_KEYSTORE_*`; l'originale è sul Mac in `~/.config/musicx/android/`) e lo mette in una
release. Senza quella chiave un APK nuovo non si installa sopra il vecchio.

Per provarla nell'emulatore contro il server di sviluppo:

```bash
adb reverse tcp:5173 tcp:5173
CAP_SERVER_URL='http://localhost:5173/?fake=8' npx cap sync android
cd android && ./gradlew installDebug
```

- **Libreria**: tutto l'albero di `/rob/music` letto in una chiamata e salvato nel browser.
  Navigazione per cartelle e ricerca istantanea su titolo, artista, album e nome cartella.
- **Playlist**: sono le playlist native di pCloud (API `collection_*`), quindi le stesse su ogni
  dispositivo e visibili anche nell'app ufficiale di pCloud. Riordino trascinando, import dei
  vecchi `.m3u`. Sul Mac un brano o una cartella si trascina direttamente su una playlist della
  barra laterale (o su "Nuova playlist").
- **Selezione (Mac)**: come in Spotify, un clic seleziona un brano, Maiusc+clic l'intervallo,
  Cmd+clic aggiunge o toglie, Cmd+A tutti, Esc o un clic nel vuoto nessuno. Il doppio clic (o il
  ▶ che compare sull'icona) fa partire il brano. Trascinando un brano selezionato si porta dietro
  tutta la selezione. Sul telefono il tocco fa partire il brano, come prima.
- **Gruppi di playlist**: apribili con la freccia, nella barra laterale e nella pagina Playlist.
  pCloud non ha cartelle di playlist, quindi il gruppo sta nel nome: "CCCP ▸ Epica etica" è
  "Epica etica" nel gruppo "CCCP" (un file a parte non si potrebbe leggere: `gettextfile` è
  riservato a pcloud.com). Quali gruppi sono aperti lo ricorda ogni dispositivo per conto suo.
  Sul Mac una playlist si trascina su un gruppo (o su "Nuovo gruppo", "Fuori dai gruppi"), sia
  nella barra laterale sia nella pagina Playlist.
- **Modifica info**: dal menu ⋯ di un brano (anche quello che sta suonando, nella barra del lettore)
  si cambiano titolo, artista, album, numero di traccia e nome del file; dal ⋯ di una cartella, o
  con più brani selezionati sul Mac, artista e album di tutti insieme. I tag si scrivono dentro il
  file (`src/lib/id3.ts`, solo mp3: gli altri formati si possono solo rinominare): musicx lo scarica
  (da rclone sul Mac, dal lato nativo nell'app Android), riscrive il tag lasciando intatti audio,
  copertina e altri campi, e lo ricarica con `uploadfile` al posto del vecchio. pCloud tiene lo
  stesso fileid (il brano resta nelle playlist), rilegge subito i tag e conserva la versione
  precedente. Da Chrome sul telefono si può solo rinominare.
- **Lettore**: coda, casuale, ripeti, ripresa da dove eri rimasto. Barra spaziatrice per pausa e
  ripresa (anche subito dopo un clic; "/" porta alla ricerca). I formati che Chrome non suona
  (wma, alac…) non partono: la transcodifica mp3 di pCloud (`getaudiolink`) ha lo stesso blocco.
  A schermo spento e con i tasti multimediali funziona grazie alla Media Session di Chrome.

## Sviluppo

```bash
npm install
npm run dev          # http://localhost:5173 (se è occupata, Vite passa alla porta libera successiva)
npm test
npm run build
```

`http://localhost:5173/?fake` apre l'app con un pCloud finto (libreria inventata, brani sintetici,
playlist in memoria): serve per lavorare sull'interfaccia senza account. `?fake=30` fa brani da 30
secondi. `?fake&login` parte dalla schermata di accesso (codice giusto `123456`; email che
iniziano con `2fa`, `sms` o `mail` provano le verifiche, password `sbagliata` l'errore). Il codice
finto non entra nella build di produzione.

## Accesso a pCloud

Due modi, una volta per dispositivo:

- **Email e password**: vanno solo a pCloud (`userinfo` con `getauth`), che restituisce un token di
  sessione. Se pCloud chiede un codice (2FA o conferma di un dispositivo nuovo via email) l'app lo
  chiede a sua volta; questi passi non sono documentati da pCloud e seguono
  [go-pcloud](https://github.com/StarHack/go-pcloud). Funziona senza nessuna app registrata.
- **OAuth** ("Accedi con pCloud"): compare quando `PCLOUD_CLIENT_ID` è impostato. Diventa il pulsante
  principale e email e password restano come riserva.

Configurare OAuth (una volta sola):

1. Su <https://docs.pcloud.com/my_apps/> crea un'app con accesso a **tutto** il drive (non solo
   alla cartella dell'app). pCloud deve approvarla.
2. Redirect URI da registrare: `https://robotlabs.github.io/musicx/` e, per lo sviluppo,
   `http://localhost:5173/`.
3. Scrivi il Client ID in `src/config.ts` (`PCLOUD_CLIENT_ID`). È pubblico per costruzione: il
   flusso OAuth "token" non usa segreti.

Il token resta solo nel browser del dispositivo (localStorage). "Esci da pCloud" nel menu ⋯ lo
cancella e, per quello di sessione, lo invalida anche su pCloud.

## Pubblicazione

Ogni push su `main` pubblica `dist/` su GitHub Pages tramite `.github/workflows/pages.yml`
(il job parte solo se il repo è pubblico).

## Scelte da non rifare

- Niente mount di pCloud sul Mac (pCloud Drive, rclone nfsmount, FUSE, WebDAV): bloccavano Finder
  e VLC in modo irrecuperabile. Il vecchio player basato su `rclone serve http` è in `legacy/`;
  il servizio rclone invece resta acceso, perché sul Mac l'audio di musicx passa da lì.
- Niente app native "vere": su Android il guscio Capacitor serve solo per i link di pCloud e la
  Media Session, tutto il resto è il sito. Sul Mac basta la PWA.

## Struttura

- `src/lib/pcloud.ts` – chiamate all'API pCloud
- `src/lib/auth.ts`, `src/lib/passwordLogin.ts` – accesso OAuth e con email e password
- `src/lib/library.ts` – indice della libreria, ricerca, cache in IndexedDB
- `src/lib/player.ts` – elemento audio, coda, Media Session, tentativi di recupero
- `src/lib/localSource.ts` – i brani da rclone sul Mac, permesso "rete locale", messaggi d'errore
- `src/lib/native.ts` – cosa cambia dentro l'app Android (link di pCloud dal lato nativo)
- `android/`, `capacitor.config.ts`, `assets/` – il guscio Android e le sorgenti delle sue icone
- `src/lib/queue.ts` – logica della coda (pura, testata)
- `src/lib/playlists.ts` – playlist pCloud, modifiche in fila una alla volta
- `src/lib/m3u.ts` – import dei vecchi `.m3u`
- `src/lib/fake.ts` – pCloud finto per lo sviluppo
- `src/ui/` – interfaccia React
