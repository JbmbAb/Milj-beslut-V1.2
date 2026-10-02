#!/bin/sh
# Kör image-smoken mot en byggd image, utan nätverk och utan databas.
#
#   deploy/onprem/smoke-image.sh <image> [<commit-ish>]
#
# Smoken tas ur commitens egna bytes (git archive av deploy/onprem/image-smoke),
# som standard den commit imagen är märkt med (org.opencontainers.image.revision).
# Containern startas med --network none och --rm. Ingen app-modul utvärderas
# (se image-smoke/link-only-hooks.mjs), så ingen process försöker nå en databas.
set -eu
export MSYS_NO_PATHCONV=1

image="${1:?usage: deploy/onprem/smoke-image.sh <image> [<commit-ish>]}"
rev="${2:-$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")}"
sha="$(git rev-parse --verify "${rev}^{commit}")"

echo "image=$image"
echo "image_id=$(docker image inspect --format '{{.Id}}' "$image")"
echo "smoke_from_commit=$sha"

git -c core.autocrlf=false -c core.eol=lf archive --format=tar "$sha" deploy/onprem/image-smoke \
  | docker run --rm -i --network none "$image" sh -c \
    'mkdir -p /tmp/smoke && tar -xf - -C /tmp/smoke && cd /app && exec node /tmp/smoke/deploy/onprem/image-smoke/smoke.mjs'
