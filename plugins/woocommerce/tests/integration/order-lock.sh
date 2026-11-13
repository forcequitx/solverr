#!/usr/bin/env bash
# Tests the webhook handler's order lock in real WordPress + MariaDB containers with throwaway passwords.
# Needs Docker and the images below; removes its containers and network on exit. Usage: bash order-lock.sh
set -euo pipefail

MARIADB_IMAGE=mariadb:11@sha256:c4124d1afa875e47f2892edf26b482fa54f796e2f342d3717a04ca091a22a9bd
WORDPRESS_IMAGE=wordpress:6.8-php8.3-apache@sha256:30bff39330d1693b0ce13d32fc9b7bb67193064f040b7d60d3494e136fa599d4
WP_CLI_IMAGE=wordpress:cli-php8.3@sha256:a4fff017eb08c03187e90fe52d4bff8d3a4d4a5103de05829a6e747c4ca3056e

here=$(cd "$(dirname "$0")" && pwd)
plugin=$(cd "$here/../../solverr-woocommerce" && pwd)
# Docker Desktop on Windows needs Windows paths; Git Bash must not rewrite the container paths.
if command -v cygpath >/dev/null 2>&1; then
	here=$(cygpath -w "$here")
	plugin=$(cygpath -w "$plugin")
	export MSYS_NO_PATHCONV=1
fi

run_id=$(openssl rand -hex 4)
network=solverr-lock-test-$run_id
db=solverr-lock-db-$run_id
web=solverr-lock-wp-$run_id
db_password=$(openssl rand -hex 16)

cleanup() {
	docker rm -f "$web" "$db" >/dev/null 2>&1 || true
	docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The image's wp-config.php reads these at runtime, so the web and WP-CLI containers both get them.
wordpress_env=(-e WORDPRESS_DB_HOST="$db" -e WORDPRESS_DB_USER=wp -e WORDPRESS_DB_PASSWORD="$db_password" -e WORDPRESS_DB_NAME=wp)

docker network create "$network" >/dev/null
docker run -d --name "$db" --network "$network" \
	-e MARIADB_RANDOM_ROOT_PASSWORD=1 -e MARIADB_DATABASE=wp -e MARIADB_USER=wp -e MARIADB_PASSWORD="$db_password" \
	"$MARIADB_IMAGE" >/dev/null
docker run -d --name "$web" --network "$network" "${wordpress_env[@]}" "$WORDPRESS_IMAGE" >/dev/null

# Runs WP-CLI as the web server's user on the WordPress files, with the plugin and this folder mounted read-only.
wp() {
	docker run --rm --network "$network" --volumes-from "$web" --user 33:33 "${wordpress_env[@]}" \
		-v "$plugin:/plugin:ro" -v "$here:/tests:ro" "$WP_CLI_IMAGE" wp --path=/var/www/html "$@"
}

for _ in $(seq 90); do
	if docker exec "$web" test -f /var/www/html/wp-config.php && docker exec "$db" healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; then
		break
	fi
	sleep 1
done
wp core install --url=http://localhost --title=lock-test --admin_user=admin --admin_password="$(openssl rand -hex 16)" \
	--admin_email=admin@example.com --skip-email >/dev/null

echo "Held lock: a second request waits 3 s and fails"
wp eval-file /tests/order-lock.php hold &
holder=$!
wp eval-file /tests/order-lock.php busy
wait "$holder"

echo "Release at the end of the request"
wp eval-file /tests/order-lock.php clean
wp eval-file /tests/order-lock.php free
wp eval-file /tests/order-lock.php clean

echo "Stale takeover"
wp eval-file /tests/order-lock.php stale
wp eval-file /tests/order-lock.php clean

echo "Order lock tests passed"
