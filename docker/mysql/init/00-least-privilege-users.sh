#!/bin/sh
set -eu

case "$MYSQL_DATABASE" in
  ''|*[!A-Za-z0-9_]*)
    echo "MYSQL_DATABASE contains unsupported identifier characters" >&2
    exit 1
    ;;
esac

if [ -z "${MYSQL_MIGRATION_PASSWORD:-}" ]; then
  echo "MYSQL_MIGRATION_PASSWORD is required" >&2
  exit 1
fi

case "$MYSQL_MIGRATION_PASSWORD" in
  *[!A-Za-z0-9._~-]*)
    echo "MYSQL_MIGRATION_PASSWORD must use a SQL-safe base64url-style alphabet" >&2
    exit 1
    ;;
esac

mysql --protocol=socket -uroot -p"$MYSQL_ROOT_PASSWORD" <<-EOSQL
  CREATE USER IF NOT EXISTS 'migration_user'@'%' IDENTIFIED BY '$MYSQL_MIGRATION_PASSWORD';
  GRANT ALL PRIVILEGES ON \`$MYSQL_DATABASE\`.* TO 'migration_user'@'%';
  REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'app_user'@'%';
  GRANT SELECT, INSERT, UPDATE, DELETE ON \`$MYSQL_DATABASE\`.* TO 'app_user'@'%';
  FLUSH PRIVILEGES;
EOSQL
