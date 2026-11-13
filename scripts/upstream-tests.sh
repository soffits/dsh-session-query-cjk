#!/usr/bin/env bash
# Run upstream's sqlite.spec.ts for one DSH release tag against this package's lib/index.js.
# Usage: scripts/upstream-tests.sh [tag]   (default: dsh-v<upstream version from the devDependency>)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$here/node_modules/@deepseek-ai/dsh-session-query-sqlite/package.json').version")"
tag="${1:-dsh-v$version}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL "https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/$tag/packages/session-query/session-query-sqlite/tests/sqlite.spec.ts" -o "$work/sqlite.spec.ts"
cd "$work"
echo '{"name":"upstream-tests","private":true,"type":"module"}' > package.json
npm install --silent --no-audit --no-fund vitest@3 >/dev/null
ln -s "$here/node_modules/@deepseek-ai" node_modules/@deepseek-ai
cat > vitest.config.mjs <<EOF
export default {
  resolve: { alias: [{ find: /^@deepseek-ai\/dsh-session-query-sqlite$/, replacement: '$here/lib/index.js' }] },
  test: { include: ['sqlite.spec.ts'], testTimeout: 30000 },
}
EOF
echo "upstream $tag tests against $here/lib/index.js"
npx vitest run
