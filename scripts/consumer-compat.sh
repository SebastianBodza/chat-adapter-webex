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

case "$TARGET" in
  minimum) CHAT_VERSION="$(node -p 'require(process.argv[1]).peerDependencies.chat.replace(/^[^0-9]*/, "")' "$ROOT/package.json")" ;;
  latest) CHAT_VERSION="$(npm view chat version)" ;;
  *) CHAT_VERSION="$TARGET" ;;
esac

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
npm ls chat @chat-adapter/shared @chat-adapter/state-memory --all || true

npx vitest run test/integration
