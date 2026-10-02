#!/bin/sh
# Kör image-smoken mot en byggd image, utan nätverk och utan databas.
#
#   sh deploy/onprem/smoke-image.sh <image> [<commit-ish>]   (från repo-roten)
#
# Smoken tas ur commitens egna bytes (git archive av deploy/onprem/image-smoke),
# som standard den commit imagen är märkt med (org.opencontainers.image.revision).
# Varje container startas med --network none och --rm. Ingen app-modul
# utvärderas (se image-smoke/link-only-hooks.mjs), så ingen process försöker
# nå en databas.
#
# Två körningar:
#   main             S1-S4 och N1 mot imagen som den är.
#   packages-hidden  N2 i en egen container med en tom tmpfs över /app/packages.
set -eu
export MSYS_NO_PATHCONV=1

image="${1:?usage: sh deploy/onprem/smoke-image.sh <image> [<commit-ish>]}"
rev="${2:-$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")}"
sha="$(git rev-parse --verify "${rev}^{commit}")"
run='mkdir -p /tmp/smoke && tar -xf - -C /tmp/smoke && cd /app && exec node /tmp/smoke/deploy/onprem/image-smoke/smoke.mjs'

smoke_tar() {
  git -c core.autocrlf=false -c core.eol=lf archive --format=tar "$sha" deploy/onprem/image-smoke
}

echo "image=$image"
echo "image_id=$(docker image inspect --format '{{.Id}}' "$image")"
echo "smoke_from_commit=$sha"

main_rc=0
smoke_tar | docker run --rm -i --network none "$image" sh -c "$run main" || main_rc=$?

hidden_rc=0
smoke_tar | docker run --rm -i --network none --tmpfs /app/packages "$image" sh -c "$run packages-hidden" || hidden_rc=$?

echo "smoke_main_exit=$main_rc smoke_packages_hidden_exit=$hidden_rc"
if [ "$main_rc" -eq 0 ] && [ "$hidden_rc" -eq 0 ]; then
  echo "IMAGE_SMOKE_OVERALL=PASS"
  exit 0
fi
echo "IMAGE_SMOKE_OVERALL=NOT_PASS"
exit 1
