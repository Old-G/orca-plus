#!/usr/bin/env bash
# Creates the local "Orca+ Local Signing" code-signing certificate that
# scripts/build-orca-plus-mac.sh signs with, so macOS privacy grants survive rebuilds.
#
#   scripts/orca-plus-signing-cert.sh   create + import into the login keychain (once per Mac)
#
# Trusting it for code signing asks for your password, so the script prints that command.
set -euo pipefail

name="Orca+ Local Signing"
keychain="$HOME/Library/Keychains/login.keychain-db"

if security find-certificate -c "$name" "$keychain" >/dev/null 2>&1; then
  echo "orca-plus-signing-cert: \"$name\" is already in the login keychain"
else
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  cat >"$work/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $name
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
  # Why /usr/bin/openssl: `security import` rejects PKCS#12 files written by OpenSSL 3.
  /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$work/cert.cnf" \
    -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
  pass=$(/usr/bin/openssl rand -hex 16)
  /usr/bin/openssl pkcs12 -export -name "$name" -inkey "$work/key.pem" -in "$work/cert.pem" \
    -out "$work/cert.p12" -passout "pass:$pass"
  security import "$work/cert.p12" -k "$keychain" -P "$pass" -T /usr/bin/codesign -T /usr/bin/security
fi

if security find-identity -v -p codesigning | grep -qF "\"$name\""; then
  echo "orca-plus-signing-cert: \"$name\" is trusted for code signing"
  exit 0
fi
pem="${TMPDIR:-/tmp}/orca-plus-local-signing.pem"
security find-certificate -c "$name" -p "$keychain" >"$pem"
echo "orca-plus-signing-cert: trust it for code signing only (asks for your password):"
echo "  security add-trusted-cert -r trustRoot -p codeSign -k \"$keychain\" \"$pem\""
