#!/bin/sh
# Bygger Mimer-appens image från exakt en commits bytes, aldrig från arbetsträdet.
#
#   sh deploy/onprem/build-image.sh <commit-ish> [image-tag]   (från repo-roten)
#
# - Kontexten är `git archive <SHA>`: bara spårade filer. Ospårade kataloger och
#   .env.local i en checkout kan inte komma med.
# - Exporten tvingas till LF. Annars skriver git archive CRLF för text=auto-filer
#   på en Windows-värd (core.eol=native), och samma commit ger olika bytes
#   beroende på värd.
# - Imagen märks med org.opencontainers.image.revision=<SHA>.
# - Ingenting pushas och ingen registry-inloggning görs.
#
# Samma image kör web (CMD) och de fyra LU-arbetarna (kommandon i Dockerfile).
set -eu
export MSYS_NO_PATHCONV=1

rev="${1:?usage: sh deploy/onprem/build-image.sh <commit-ish> [image-tag]}"
sha="$(git rev-parse --verify "${rev}^{commit}")"
tag="${2:-mimer-app:$(printf '%s' "$sha" | cut -c1-12)}"
target="${MIMER_IMAGE_TARGET:-web}"

archive() {
  git -c core.autocrlf=false -c core.eol=lf archive --format=tar "$sha"
}

echo "source_commit=$sha"
echo "source_tree=$(git rev-parse "${sha}^{tree}")"
echo "context_tar_sha256=$(archive | sha256sum | cut -d' ' -f1)"
echo "target=$target"
echo "image_tag=$tag"

archive | docker build \
  --target "$target" \
  --label "org.opencontainers.image.revision=$sha" \
  -t "$tag" \
  -

echo "image_id=$(docker image inspect --format '{{.Id}}' "$tag")"
