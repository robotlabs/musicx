#!/bin/bash
# Da mount NFS a HTTP puro: elimina il mount (fonte dei congelamenti)
# e serve la musica su http://127.0.0.1:8620 con rclone serve http.
# Uso: bash switch-to-http.sh
set -uo pipefail

OLD_LABEL="com.roberto.rclone-pcloud"
OLD_PLIST="$HOME/Library/LaunchAgents/$OLD_LABEL.plist"
LABEL="com.roberto.rclone-music-http"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT=8620
MUSIC_REMOTE="pcloud:rob/music"
LOG_DIR="$HOME/Library/Logs/rclone"
RCLONE_BIN="$(command -v rclone)"

echo "== 1/3 Rimozione definitiva del mount NFS =="
launchctl bootout "gui/$(id -u)/$OLD_LABEL" 2>/dev/null && echo "  servizio NFS fermato" || echo "  servizio NFS già fermo"
diskutil unmount force "$HOME/pCloud-Music" 2>/dev/null && echo "  volume smontato" || echo "  volume già smontato (ok)"
rm -f "$OLD_PLIST"
rmdir "$HOME/pCloud-Music" 2>/dev/null || true
echo "  mount NFS eliminato: non potrà più congelare niente."

echo ""
echo "== 2/3 Servizio HTTP (rclone serve http) =="
mkdir -p "$LOG_DIR"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$RCLONE_BIN</string>
    <string>serve</string>
    <string>http</string>
    <string>$MUSIC_REMOTE</string>
    <string>--addr</string><string>127.0.0.1:$PORT</string>
    <string>--read-only</string>
    <string>--vfs-cache-mode</string><string>full</string>
    <string>--vfs-cache-max-size</string><string>10G</string>
    <string>--dir-cache-time</string><string>72h</string>
    <string>--allow-origin</string><string>*</string>
    <string>--log-file</string><string>$LOG_DIR/music-http.log</string>
    <string>--log-level</string><string>INFO</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/http-launchd-out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/http-launchd-err.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "  servizio avviato (parte da solo a ogni login)."

echo ""
echo "== 3/3 Test =="
sleep 3
CODE="$(curl -s --max-time 15 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || echo 000)"
if [ "$CODE" = "200" ]; then
  echo "✅ La musica risponde su http://127.0.0.1:$PORT/"
  echo "   Ora apri player.html (nella cartella musicx) e suona."
else
  echo "⚠️  Il server non risponde ancora (HTTP $CODE)."
  echo "   Riprova tra 10 secondi:  curl -s http://127.0.0.1:$PORT/ | head"
  echo "   Log:                     tail -30 $LOG_DIR/music-http.log"
fi

echo ""
echo "Comandi utili:"
echo "  Riavvia servizio: launchctl kickstart -k gui/\$(id -u)/$LABEL"
echo "  Spegni:           launchctl bootout gui/\$(id -u)/$LABEL"
echo "  Log:              tail -f $LOG_DIR/music-http.log"
