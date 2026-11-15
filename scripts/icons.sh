#!/bin/bash
# Rigenera le icone PNG da public/favicon.svg. Serve rsvg-convert (brew install librsvg).
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=public/favicon.svg
OUT=public/icons
mkdir -p "$OUT"
rsvg-convert -w 192 -h 192 "$SRC" -o "$OUT/icon-192.png"
rsvg-convert -w 512 -h 512 "$SRC" -o "$OUT/icon-512.png"
rsvg-convert -w 180 -h 180 "$SRC" -o "$OUT/apple-touch-icon.png"

# Versione "maskable" per Android: sfondo pieno e simbolo dentro la zona sicura (80% centrale).
MASK=$(mktemp -t musicx-mask).svg
cat > "$MASK" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a98bff"/>
      <stop offset="1" stop-color="#5b3fd9"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g fill="#ffffff" transform="translate(256 256) scale(0.72) translate(-256 -236)">
    <path d="M206 132 L376 104 V318 a52 52 0 1 1 -32 -48 V168 L238 186 V350 a52 52 0 1 1 -32 -48 Z"/>
  </g>
</svg>
EOF
rsvg-convert -w 512 -h 512 "$MASK" -o "$OUT/maskable-512.png"
rm -f "$MASK"
echo "icone aggiornate in $OUT"
