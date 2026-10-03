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
# - tar.umask pinnas (0002, gits default). Annars styr användarens git-konfig
#   filrättigheterna i kontexten, och samma commit ger olika kontext-bytes och
#   olika lager beroende på användare.
# - Imagen märks med org.opencontainers.image.revision=<SHA>.
# - W-U42: commit, träd och kompositionshash lämnas in som byggargument, så att
#   bygget kan skriva release-identity.json (product-release-v3). Kompositions-
#   hashen räknas med samma algoritm som bygget och processerna använder
#   (scripts/release/write-build-identity.mjs --print composition) över commitens
#   EGNA Dockerfile, .dockerignore och deploy/onprem -- aldrig arbetsträdets --
#   exporterade till en tillfällig katalog som tas bort igen.
# - Ingenting pushas och ingen registry-inloggning görs.
#
# Samma image kör web (CMD) och de fyra LU-arbetarna (kommandon i Dockerfile).
set -eu
export MSYS_NO_PATHCONV=1

rev="${1:?usage: sh deploy/onprem/build-image.sh <commit-ish> [image-tag]}"
sha="$(git rev-parse --verify "${rev}^{commit}")"
tree="$(git rev-parse "${sha}^{tree}")"
tag="${2:-mimer-app:$(printf '%s' "$sha" | cut -c1-12)}"
target="${MIMER_IMAGE_TARGET:-web}"

# Hela kontexten utan argument; med pathspec bara de angivna sökvägarna ur samma commit.
archive() {
  git -c core.autocrlf=false -c core.eol=lf -c tar.umask=0002 archive --format=tar "$sha" "$@"
}

composition_dir="$(mktemp -d)"
trap 'rm -rf "$composition_dir"' EXIT
archive Dockerfile .dockerignore deploy/onprem | tar -x -C "$composition_dir"
# På en Windows-värd (Git Bash) får node en nativ sökväg; cygpath saknas på Linux.
composition_root="$(cygpath -m "$composition_dir" 2>/dev/null || printf '%s' "$composition_dir")"
composition="$(node scripts/release/write-build-identity.mjs --root "$composition_root" --print composition)"

echo "source_commit=$sha"
echo "source_tree=$tree"
echo "composition_manifest_sha256=$composition"
echo "context_tar_sha256=$(archive | sha256sum | cut -d' ' -f1)"
echo "target=$target"
echo "image_tag=$tag"

archive | docker build \
  --target "$target" \
  --build-arg "SOURCE_COMMIT_SHA=$sha" \
  --build-arg "SOURCE_TREE_SHA=$tree" \
  --build-arg "COMPOSITION_MANIFEST_SHA256=$composition" \
  --label "org.opencontainers.image.revision=$sha" \
  -t "$tag" \
  -

echo "image_id=$(docker image inspect --format '{{.Id}}' "$tag")"
