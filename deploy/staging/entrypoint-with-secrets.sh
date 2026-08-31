#!/bin/sh
set -eu

if [ -f /run/secrets/jwt_access_secret ]; then
  export JWT_ACCESS_SECRET="$(cat /run/secrets/jwt_access_secret)"
fi
if [ -f /run/secrets/jwt_refresh_secret ]; then
  export JWT_REFRESH_SECRET="$(cat /run/secrets/jwt_refresh_secret)"
fi
if [ -f /run/secrets/admin_console_password ]; then
  export ADMIN_CONSOLE_PASSWORD="$(cat /run/secrets/admin_console_password)"
fi
if [ -f /run/secrets/lu_signer_key ]; then
  export LU_SIGNER_PRIVATE_KEY_PEM="$(cat /run/secrets/lu_signer_key)"
fi

exec "$@"
