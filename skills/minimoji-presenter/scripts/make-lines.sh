#!/usr/bin/env bash
# slides.json → lines/: voices every slide's `say` (and a waiting step's `nudge`) and re-times each clip on its
# final audio, one call at a time under the rate limit, with `minimoji say --texts`. Run it in the folder that
# holds slides.json (or pass that folder first). Unchanged slides are skipped (lines/manifest.json), so
# rewording one line re-voices only that line.
#
#   bash make-lines.sh deck/              your ElevenLabs key and the deck's voice (production)
#   bash make-lines.sh deck/ --server     Minimoji's voice on your Minimoji key (trying things out;
#                                         catalogue voices only: dash, person, alien, …)
#   bash make-lines.sh deck/ --dry-run    what would be sent; nothing is
#
# The key comes from ELEVENLABS_API_KEY, else from .env.local, and is never printed: every line of output,
# errors included, goes through a redactor for sk_… and xi-… keys and the key itself.
set -euo pipefail
set +x

if [ $# -gt 0 ] && [ -d "$1" ]; then cd "$1"; shift; fi
[ -f slides.json ] || { echo "make-lines: no slides.json in $(pwd)" >&2; exit 1; }

server=0
for arg in "$@"; do [ "$arg" = "--server" ] && server=1; done
if [ -z "${ELEVENLABS_API_KEY:-}" ] && [ -f .env.local ]; then
  ELEVENLABS_API_KEY="$(grep -E '^ELEVENLABS_API_KEY=' .env.local | head -1 | cut -d= -f2- | tr -d "\"' \r" || true)"   # quotes, spaces, a CRLF file's \r
  export ELEVENLABS_API_KEY
fi
if [ "$server" = 0 ] && [ -z "${ELEVENLABS_API_KEY:-}" ] && ! printf '%s\n' "$@" | grep -qx -- '--dry-run'; then
  echo "make-lines: ELEVENLABS_API_KEY is not set (environment or .env.local); or pass --server to try Minimoji's voice" >&2
  exit 1
fi

# the key itself and anything shaped like one, replaced on every line
redact() {
  awk '{
    k = ENVIRON["ELEVENLABS_API_KEY"]
    if (k != "") { while ((i = index($0, k)) > 0) $0 = substr($0, 1, i - 1) "[key]" substr($0, i + length(k)) }
    gsub(/sk_[A-Za-z0-9_-]+/, "sk_[key]"); gsub(/xi-[A-Za-z0-9_-]+/, "xi-[key]")
    print; fflush()
  }'
}

# MINIMOJI_BIN: another minimoji (a checkout's packages/cli/src/cli.js, a test's stub)
# say --texts arrived in minimoji 0.9.0: an older cached copy would refuse it
read -r -a bin <<< "${MINIMOJI_BIN:-npx --yes minimoji@^0.9.0}"
status=0
"${bin[@]}" say --texts slides.json --out lines "$@" 2> >(redact >&2) | redact || status=$?
wait
exit "$status"
