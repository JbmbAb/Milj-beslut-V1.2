#!/bin/sh
# Stub reproducing the trusted runner's Docker CLI behaviour: `docker info --format` exits 0 with an empty
# ServerVersion (error text on stderr) while the daemon cannot be reached; every build fails.
case "$1" in
  info) echo ""; echo "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock" >&2; exit 0 ;;
  build) echo "ERROR: permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock" >&2; exit 1 ;;
  version) exit 1 ;;
  *) exit 1 ;;
esac
