#!/bin/sh
# Creates the database TLS files in deploy/postgres-tls/: ca.crt and server.crt/server.key (DB_HOST) that PgBouncer serves, and client-ca.crt
# with client.crt/client.key, the certificate the website must show before its password is checked. Each CA key is deleted after signing.
# Run on the server, as root, from the repository root: sudo sh deploy/postgres-tls.sh db.example.com (again later adds only missing files).
set -eu

DB_HOST="${1:-}"
DIR="$(dirname "$0")/postgres-tls"
DAYS=3650

if [ -e "$DIR/server.crt" ] && [ -e "$DIR/client-ca.crt" ]; then
  echo "$DIR already holds the server and client certificates; delete $DIR first to make new ones." >&2
  exit 1
fi
mkdir -p "$DIR"
# PgBouncer (uid 999) must enter the folder whatever the caller's umask; each key file keeps its own owner-only mode.
chmod 755 "$DIR"
cd "$DIR"

if [ ! -e server.crt ]; then
  [ -n "$DB_HOST" ] || { echo "Give the hostname (or IP address) the website uses in DATABASE_URL, such as db.example.com" >&2; exit 1; }
  case "$DB_HOST" in
    *[!0-9.]*) SAN="DNS:$DB_HOST" ;;
    *) SAN="IP:$DB_HOST" ;;
  esac
  openssl req -x509 -newkey rsa:4096 -nodes -days "$DAYS" -subj "/CN=Solverr Postgres CA" -keyout ca.key -out ca.crt
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$DB_HOST" -keyout server.key -out server.csr
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$SAN" > server.ext
  openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days "$DAYS" -extfile server.ext -out server.crt
  rm -f ca.key ca.srl server.csr server.ext
  chown 999:999 server.key server.crt
  chmod 600 server.key
  chmod 644 server.crt ca.crt
fi

# A CA of its own for clients, so the server's certificate can never pass as the website's.
if [ ! -e client-ca.crt ]; then
  openssl req -x509 -newkey rsa:4096 -nodes -days "$DAYS" -subj "/CN=Solverr Postgres client CA" -keyout client-ca.key -out client-ca.crt
  openssl req -newkey rsa:2048 -nodes -subj "/CN=solverr_web" -keyout client.key -out client.csr
  printf 'extendedKeyUsage=clientAuth\n' > client.ext
  openssl x509 -req -in client.csr -CA client-ca.crt -CAkey client-ca.key -CAcreateserial -days "$DAYS" -extfile client.ext -out client.crt
  rm -f client-ca.key client-ca.srl client.csr client.ext
  chmod 644 client-ca.crt client.crt
  chmod 600 client.key
fi

echo "Done. On Vercel, set DATABASE_CA_CERT to $DIR/ca.crt, DATABASE_CLIENT_CERT to $DIR/client.crt and DATABASE_CLIENT_KEY to $DIR/client.key."
echo "Then delete $DIR/client.key from this server; PgBouncer needs only client-ca.crt."
