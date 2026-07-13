#!/bin/sh
set -eu

password_file=${REDIS_PASSWORD_FILE:-/run/secrets/redis_password}
if [ ! -f "$password_file" ]; then
  echo "Redis password secret is unavailable" >&2
  exit 1
fi

password=$(cat "$password_file")
case "$password" in
  ''|*[!A-Za-z0-9._~-]*)
    echo "Redis password must use a base64url-style alphabet" >&2
    exit 1
    ;;
esac

umask 077
cat > /tmp/redis-production.conf <<EOF
bind 0.0.0.0
protected-mode yes
port 6379
appendonly yes
appendfsync everysec
maxmemory-policy noeviction
requirepass $password
EOF

exec redis-server /tmp/redis-production.conf
