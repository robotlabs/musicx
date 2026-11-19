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
- **Android**: l'app musicx (Capacitor) ha dentro la stessa interfaccia del sito e chiede i link dal
  lato nativo (`CapacitorHttp`, senza Origin né Referer). Il link vale per l'IP che l'ha chiesto, cioè il
  telefono, e l'`<audio>` della pagina lo suona. Notifica, schermata di blocco e musica a schermo
  spento li fa `@capgo/capacitor-media-session`. In Chrome sul telefono i brani non suonano: il
  menu ⋯ offre di scaricare l'app.

## App Android

Si scarica da <https://github.com/robotlabs/musicx/releases/latest/download/musicx.apk> e si
installa una volta (Android chiede di consentire le app da origine sconosciuta). L'interfaccia sta
dentro l'APK, così l'app si apre anche senza rete; quando c'è rete legge `version.json` dal sito e,
se c'è una versione nuova, la scarica nei file dell'app e la usa da lì (`src/lib/appUpdate.ts`,
`WebView.setServerBasePath`): al prossimo avvio, o subito con "Aggiorna". I file locali sono serviti
come `https://robotlabs.github.io`, la stessa origine del sito che le versioni vecchie caricavano:
accesso, coda e libreria restano. L'APK va rifatto solo quando cambia la parte nativa (`android/`,
`capacitor.config.ts`, dipendenze): lo fa
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
  Poi si aggiorna da sola: quello che cambia su pCloud (dall'app di pCloud, dal Finder via rclone,
  da un altro dispositivo) arriva in pochi secondi senza rileggere tutto. È `diff` di pCloud: una
  richiesta resta aperta finché succede qualcosa e ogni evento porta i metadati completi del file;
  l'indice ricorda l'ultimo cambiamento che contiene, così all'avvio recupera quelli persi
  (`src/lib/liveLibrary.ts`). Una cartella arrivata da fuori della libreria, di cui non si conosce
  il contenuto, fa rileggere tutto.
  Navigazione per cartelle e ricerca istantanea su titolo, artista, album e nome cartella.
  In una cartella con un album solo i brani seguono il numero di traccia (dal tag o, se manca, dal
  nome del file: "Track-06"); nelle cartelle con più album vanno in ordine alfabetico, a meno che
  i numeri siano tutti diversi. Trascinando la maniglia ⠿ di un brano (cartelle di soli mp3) il
  nuovo ordine diventa il numero di traccia scritto nei file, 1, 2, 3…: l'indice cambia subito e i
  file si riscrivono in sottofondo, solo quelli col numero cambiato (oltre 20 file chiede prima).
- **Precaricamento**: mentre suona un brano i 2 successivi si scaricano sul dispositivo, così il
  cambio è immediato e riascoltarli non usa la rete. Stanno in una cache con un limite (1 GB, si
  cambia in "Download e spazio"): quando è piena escono i meno ascoltati.
- **Download per l'ascolto offline**: "Scarica" dal ⋯ di un brano, di più brani, di una cartella o
  di una playlist (o con il pulsante ⬇ nell'intestazione), come in Spotify; i brani scaricati hanno
  il segno verde. Si ricorda la scelta, non i file: una playlist scaricata segue pCloud (i brani
  aggiunti si scaricano, quelli tolti spariscono), e così una cartella. Senza rete libreria e
  playlist si vedono lo stesso (le playlist hanno una copia sul dispositivo), i brani non salvati
  sono spenti e il lettore salta a quelli che ci sono. "Download e spazio" (menu ⋯ dell'app) dice
  quanto occupano e ha "Pulisci tutto": via download, precaricati e copia di libreria e playlist,
  si resta dentro. Nell'app Android i file stanno nella memoria privata dell'app e li scarica il
  lato nativo (`@capacitor/file-transfer`: i server dei file di pCloud non lasciano leggere i brani
  a una pagina); sul Mac arrivano da rclone e stanno nello spazio privato di Chrome (OPFS). Si
  suonano da un blob. Elenco e scelte stanno in file accanto ai brani (`index.json`, `pins.json`),
  non in localStorage, che nell'app può perdere le ultime scritture se viene chiusa di forza;
  comandano comunque i file: un brano non si butta mai solo perché manca dall'elenco
  (`src/lib/audioStore.ts`, `src/lib/downloads.ts`).
- **Sposta in cartella**: dal ⋯ di un brano, di più brani selezionati o di una cartella. Si sceglie la
  cartella navigando quelle vere di pCloud (anche le vuote) e se ne può creare una nuova; in cima
  c'è l'ultima usata. Sul Mac basta trascinare brani o cartelle su una cartella della lista o del
  percorso in alto. Sposta pCloud (`renamefile`/`renamefolder` con `tofolderid`): stesso fileid,
  quindi i brani restano nelle playlist. Un file con lo stesso nome già là non viene sostituito:
  quel brano resta dov'è. L'indice si aggiorna subito; rclone se ne accorge da solo in pochi secondi.
- **Doppioni** (menu ⋯ dell'app, "Trova doppioni"): i file identici (stessa impronta e dimensione
  secondo pCloud) e lo stesso brano in file diversi (stesso artista e titolo, per esempio un mp3 e un
  flac). Per ogni copia: ascoltarla, andare alla sua cartella, "Tieni questo, elimina gli altri" o
  "Elimina"; si eliminano nel cestino di pCloud, da dove si recuperano.
- **Da YouTube** (solo Mac, nella barra laterale): scrivi il titolo, scegli il video, e il brano
  diventa un mp3 nella cartella dell'artista su pCloud (quella che c'è già, cercata per nome o per i
  tag dei brani; altrimenti una nuova in `/rob/music`), con nome `Artista - Titolo.mp3`. Artista,
  titolo, album, numero, anno e copertina arrivano dal catalogo di iTunes e si possono correggere;
  la cartella si può cambiare. Prima di YouTube cerca nella libreria: "Ce l'hai già" mostra i brani
  che corrispondono, e prima di scaricare avvisa se lo stesso artista e titolo c'è già (il pulsante
  diventa "Scarica lo stesso"). Lo fa un piccolo servizio sul Mac (`helper/youtube-helper.mjs`, solo
  Node, yt-dlp e ffmpeg), che la pagina trova su `127.0.0.1:8621` (o le porte successive, fino alla
  8630) e che risponde solo a musicx. I termini di YouTube non permettono di scaricare: è per uso
  personale.
- **Playlist**: sono le playlist native di pCloud (API `collection_*`), quindi le stesse su ogni
  dispositivo e visibili anche nell'app ufficiale di pCloud. Riordino trascinando o, dal ⋯,
  "Ordina per numero di traccia" (album nell'ordine in cui compaiono, dentro il numero). "Importa"
  crea una playlist da un vecchio `.m3u` o da una playlist esportata da iTunes (`.xml`): propone i
  file che stanno nella cartella della musica su pCloud, o se ne sceglie uno dal dispositivo. I brani
  di iTunes si ritrovano per dimensione del file, nome, percorso e infine artista e titolo
  (`src/lib/itunes.ts`); quelli che mancano vengono detti per nome. Playlist preparate fuori
  dall'app si mettono in un `musicx-import.json` nella cartella della musica
  (`{"playlists":[{"name":"…","files":[fileid,…]}]}`): all'avvio l'app lo sposta nel cestino e crea
  quelle che non ci sono già, coi soli brani che esistono (`runImportJob` in
  `src/ui/importPlaylist.ts`). Sul Mac un brano o una cartella si trascina direttamente su una playlist della
  barra laterale (o su "Nuova playlist").
- **Preferiti (★)**: sul Mac la stella sta nella riga del brano (compare passandoci sopra; piena
  resta sempre) e nel lettore: un clic la mette, un altro la toglie. Sul telefono si mette dal ⋯
  del brano. La voce "Preferiti" del menu principale li elenca dall'ultimo e li fa suonare (anche in
  ordine casuale). Sono una playlist di pCloud tutta loro, "★ Preferiti", che la pagina Playlist
  non mostra: così valgono su ogni dispositivo (`src/lib/starred.ts`).
- **Da dove suona**: il lettore si ricorda la pagina da cui è partita la coda (playlist, cartella,
  preferiti, ricerca). Sul Mac un clic sul titolo del brano nel lettore riporta lì e mette in vista
  il brano che suona; sul telefono c'è "Vai a …" nel ⋯ del lettore (`src/ui/play.ts`).
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
  Il ⋯ accanto al brano che suona apre il suo menu (aggiungi a playlist, vai alla cartella,
  modifica info); sul Mac il brano si trascina dalla barra in basso su una playlist.

## Servizio YouTube sul Mac

Si installa una volta (parte da solo all'accesso, log in `~/Library/Logs/musicx/helper.log`):

```bash
brew install yt-dlp ffmpeg
./helper/install.sh
```

`./helper/install.sh remove` lo toglie. Se YouTube risponde "Sign in to confirm you're not a bot",
`./helper/install.sh --cookies chrome` fa usare a yt-dlp l'accesso a YouTube di Chrome (macOS chiede
una volta il permesso per il portachiavi). Quando YouTube cambia qualcosa basta `brew upgrade yt-dlp`.
Per provare l'app senza scaricare niente: `MUSICX_HELPER_FAKE_DOWNLOAD=1 node helper/youtube-helper.mjs`
(al posto del brano, qualche secondo di tono; ricerca e catalogo restano veri).

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

Si accede una volta per dispositivo, con email e password (OAuth c'è, ma è spento):

- **Email e password**: vanno solo a pCloud (`userinfo` con `getauth`), che restituisce un token di
  sessione. Se pCloud chiede un codice (2FA o conferma di un dispositivo nuovo via email) l'app lo
  chiede a sua volta; questi passi non sono documentati da pCloud e seguono
  [go-pcloud](https://github.com/StarHack/go-pcloud). Funziona senza nessuna app registrata.
  La sessione dura il massimo che pCloud concede: 2 anni, e scade solo dopo 62 giorni senza usarla.
- **OAuth** ("Accedi con pCloud"): spento (`OAUTH_LOGIN` in `src/config.ts`). L'app pCloud
  "robotlabs-music" è approvata e funziona, ma con un token OAuth pCloud dà libreria e brani e non
  le playlist: `collection_list` risponde 1000 "Log in required". Il codice resta pronto: sul sito
  pCloud riporta all'unico Redirect URI registrato, `https://robotlabs.github.io/musicx/`; nell'app
  la pagina di pCloud si apre in Chrome e l'app aspetta il token con `response_type=poll_token`
  (`oauth2_token` con `request_id`, come l'SDK JavaScript di pCloud), senza indirizzo di ritorno.

Com'è configurato OAuth (già fatto, app "robotlabs-music", oggi spento):

1. Su <https://docs.pcloud.com/my_apps/> un'app con accesso a **tutto** il drive (non solo alla
   cartella dell'app), approvata da pCloud.
2. Redirect URI: `https://robotlabs.github.io/musicx/` (se ne può registrare uno solo).
3. Client ID e Redirect URI in `src/config.ts` (`PCLOUD_CLIENT_ID`, `PCLOUD_REDIRECT_URI`). Il
   Client ID è pubblico per costruzione: il flusso OAuth "token" non usa segreti, e il Client
   secret non serve.

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
- `src/lib/player.ts` – elemento audio, coda, Media Session, tentativi di recupero, precaricamento
- `src/lib/audioStore.ts`, `src/lib/downloads.ts` – brani salvati sul dispositivo e download offline
- `src/lib/network.ts` – c'è rete o no (nell'app lo dice il lato nativo)
- `src/lib/appUpdate.ts` – nell'app, la versione nuova dell'interfaccia scaricata dal sito
- `src/lib/liveLibrary.ts` – la libreria che segue pCloud (`diff`)
- `src/lib/duplicates.ts` – doppioni
- `src/lib/youtube.ts`, `helper/` – "Da YouTube" e il servizio sul Mac
- `src/lib/localSource.ts` – i brani da rclone sul Mac, permesso "rete locale", messaggi d'errore
- `src/lib/native.ts` – cosa cambia dentro l'app Android (link di pCloud dal lato nativo)
- `android/`, `capacitor.config.ts`, `assets/` – il guscio Android e le sorgenti delle sue icone
- `src/lib/queue.ts` – logica della coda (pura, testata)
- `src/lib/playlists.ts` – playlist pCloud, modifiche in fila una alla volta
- `src/lib/m3u.ts`, `src/lib/itunes.ts` – import dei vecchi `.m3u` e delle playlist di iTunes
- `src/lib/starred.ts`, `src/ui/star.tsx`, `src/ui/StarredView.tsx` – preferiti
- `src/lib/fake.ts` – pCloud finto per lo sviluppo
- `src/ui/` – interfaccia React
