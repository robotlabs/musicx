#!/bin/zsh
# Installa (o reinstalla) il servizio YouTube di musicx sul Mac: parte da solo all'accesso e si
# riavvia se si ferma. Serve una volta; dopo un aggiornamento del file basta rilanciarlo.
#   ./helper/install.sh                   installa e avvia
#   ./helper/install.sh --cookies chrome  come sopra, e se YouTube chiede di accedere ("non sono un
#                                         robot") yt-dlp usa l'accesso a YouTube di Chrome (macOS chiede
#                                         una volta il permesso per il portachiavi)
#   ./helper/install.sh remove            ferma e toglie
set -euo pipefail

LABEL=com.roberto.musicx-helper
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOGS="$HOME/Library/Logs/musicx"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

if [[ "${1:-}" == "remove" ]]; then
  rm -f "$PLIST"
  echo "Servizio YouTube di musicx tolto."
  exit 0
fi

COOKIES=""
if [[ "${1:-}" == "--cookies" ]]; then COOKIES="${2:-chrome}"; fi

NODE="$(command -v node)"
for tool in yt-dlp ffmpeg; do
  command -v "$tool" >/dev/null || { echo "Manca $tool: brew install $tool"; exit 1; }
done
mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$HERE/youtube-helper.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>MUSICX_YT_COOKIES</key><string>$COOKIES</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <!-- Si riavvia se cade; se esce da solo (c'è già un'altra copia) resta fermo. -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$LOGS/helper.log</string>
  <key>StandardErrorPath</key><string>$LOGS/helper.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 1
tail -n 3 "$LOGS/helper.log" 2>/dev/null || true
echo "Servizio YouTube di musicx installato ($LABEL)."
