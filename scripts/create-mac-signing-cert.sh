#!/bin/sh
# Makes the self-signed code-signing certificate macOS releases are signed
# with when there is no Apple Developer ID (see scripts/mac-sign.cjs for why).
#
# Run ONCE, keep the output safe, and never make a second one: the certificate
# is the app's identity. A release signed with a different certificate cannot
# update an install signed with this one, and asks for the keychain again.
#
#   sh scripts/create-mac-signing-cert.sh [output-dir]
#
# Then add two repository secrets (Settings → Secrets and variables → Actions):
#   MAC_SELF_SIGN_P12_BASE64   the contents of heracles-signing.p12.base64
#   MAC_SELF_SIGN_P12_PASSWORD the password printed below
set -eu

OUT="${1:-heracles-signing}"
NAME="Heracles Records Self-Signed"
mkdir -p "$OUT"
cd "$OUT"

if [ -e heracles-signing.p12 ]; then
  echo "$OUT/heracles-signing.p12 already exists; refusing to replace the app's identity." >&2
  exit 1
fi

PASSWORD="$(openssl rand -hex 16)"

openssl req -x509 -newkey rsa:2048 -nodes -days 7300 \
  -keyout key.pem -out cert.pem -subj "/CN=$NAME" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" \
  -addext "basicConstraints=critical,CA:false"

# 3DES/SHA-1 PKCS#12, the one `security import` reads on every macOS version.
# OpenSSL 3 needs -legacy for it; LibreSSL (macOS's openssl) writes it anyway.
if openssl version | grep -q '^OpenSSL 3'; then
  LEGACY="-legacy"
else
  LEGACY=""
fi
# shellcheck disable=SC2086
openssl pkcs12 -export $LEGACY -inkey key.pem -in cert.pem -name "$NAME" \
  -out heracles-signing.p12 -passout "pass:$PASSWORD"

base64 < heracles-signing.p12 | tr -d '\n' > heracles-signing.p12.base64
rm key.pem

echo
echo "Certificate SHA-1: $(openssl x509 -in cert.pem -noout -fingerprint -sha1 | cut -d= -f2 | tr -d :)"
echo "MAC_SELF_SIGN_P12_PASSWORD: $PASSWORD"
echo "MAC_SELF_SIGN_P12_BASE64:   $(pwd)/heracles-signing.p12.base64"
echo
echo "Store heracles-signing.p12 and the password somewhere safe (a password manager)."
