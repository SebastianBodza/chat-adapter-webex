#!/usr/bin/env bash
# Runs the integration suite against the *packed* package installed into an
# empty project, the way a user would install it:
#
#   npm install @bitbasti/chat-adapter-webex chat@<version>
#
# npm resolves every other dependency (e.g. @chat-adapter/shared) on its own,
# with peer-dependency checks enabled. The tests import the built `dist/`
# through tiny shims instead of `src/`.
#
# Usage: scripts/consumer-compat.sh <minimum|latest|x.y.z> [work-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:?usage: consumer-compat.sh <minimum|latest|x.y.z> [work-dir]}"
WORK="${2:-$(mktemp -d)}"
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)" # absolute: later steps run from other directories

PEER_RANGE="$(node -p 'require(process.argv[1]).peerDependencies.chat' "$ROOT/package.json")"
semver_eval() {
  # Runs with ROOT's node_modules so `semver` resolves from the repo.
  (cd "$ROOT" && node -e "const semver = require('semver'); $1" -- "${@:2}")
}

case "$TARGET" in
  minimum) CHAT_VERSION="$(semver_eval 'console.log(semver.minVersion(process.argv[1]).version)' "$PEER_RANGE")" ;;
  latest) CHAT_VERSION="$(npm view chat version)" ;;
  *) CHAT_VERSION="$TARGET" ;;
esac

# A version outside the peer range would make a real `npm install` fail with
# ERESOLVE, even if the tests below pass. Fail early with an actionable message.
if ! semver_eval 'process.exit(semver.satisfies(process.argv[1], process.argv[2], { includePrerelease: true }) ? 0 : 1)' \
  "$CHAT_VERSION" "$PEER_RANGE"; then
  echo "::error::chat@$CHAT_VERSION is outside peerDependencies.chat ($PEER_RANGE). Users would hit ERESOLVE on install; widen the range in package.json once the adapter supports it." >&2
  exit 1
fi

lock_version() {
  node -p 'require(process.argv[1]).packages["node_modules/" + process.argv[2]].version' "$ROOT/package-lock.json" "$1"
}
VITEST_VERSION="$(lock_version vitest)"

echo "▶ chat@$CHAT_VERSION, consumer project in $WORK"

(cd "$ROOT" && npm run build --silent && npm pack --silent --pack-destination "$WORK" >/dev/null)
TARBALL="$(ls "$WORK"/bitbasti-chat-adapter-webex-*.tgz)"

APP="$WORK/consumer"
rm -rf "$APP" && mkdir -p "$APP/src" "$APP/test"
cd "$APP"
npm init -y >/dev/null
npm pkg set type=module >/dev/null && npm pkg set private=true --json >/dev/null

# The package + chat is what a user installs. state-memory is the user's state
# adapter of choice (same release line as chat); vitest is only the runner.
npm install --no-audit --no-fund "$TARBALL" "chat@$CHAT_VERSION"
npm install --no-audit --no-fund --save-dev \
  "@chat-adapter/state-memory@$CHAT_VERSION" "vitest@$VITEST_VERSION"

cp -R "$ROOT/test/integration" "$APP/test/integration"
cp "$ROOT/src/test-utils.ts" "$APP/src/test-utils.ts"
# Shims: tests import ../../src/{index,types}; point them at the installed package.
echo 'export * from "@bitbasti/chat-adapter-webex";' > "$APP/src/index.ts"
echo 'export type * from "@bitbasti/chat-adapter-webex";' > "$APP/src/types.ts"

echo "▶ resolved versions"
# Fails on an invalid tree (missing/invalid peers), which users would hit too.
npm ls chat @chat-adapter/shared @chat-adapter/state-memory --all

npx vitest run test/integration
