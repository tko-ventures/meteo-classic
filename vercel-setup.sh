#!/usr/bin/env bash
# Instaluje Vercel CLI (jeśli brak), loguje (w przeglądarce) i wdraża meteogram na produkcję.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "Brak Node.js/npm. Zainstaluj np.: brew install node  i uruchom skrypt ponownie."
  exit 1
fi
if ! command -v vercel >/dev/null 2>&1; then
  echo "→ Instaluję Vercel CLI…"
  npm i -g vercel@latest
fi
echo "→ Vercel CLI: $(vercel --version 2>/dev/null | tail -n1)"

if ! vercel whoami >/dev/null 2>&1; then
  echo "→ Logowanie: dokończ je w przeglądarce, która się otworzy."
  vercel login
fi
echo "→ Zalogowano jako: $(vercel whoami 2>/dev/null | tail -n1)"

echo "→ Wdrażam ~/dev/meteo-classic na produkcję…"
URL=$(vercel deploy --prod --yes | tail -n1)
mkdir -p .vercel
echo "$URL" > .vercel/last-deploy-url.txt
echo
echo "Gotowe: $URL"
echo "Obrazek PNG: $URL/meteogram.png?lat=51.2205&lng=18.5701"
