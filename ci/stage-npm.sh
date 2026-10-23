#!/usr/bin/env bash
# This script must be run only in a trusted, explicitly approved Jenkins release job.
# Never run it on a PR executor or a workspace shared with untrusted builds.
set -Eeuo pipefail
set +x
umask 077

: "${NPM_TOKEN:?npm stage-only token not configured}"
: "${RELEASE_TAG:?Release tag is required}"
if [[ ! "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid release tag" >&2
  exit 2
fi

node - <<'NODE'
const p = require('./package.json');
if (p.name !== '@snyxe/paperclip-space-provider') throw new Error('Unexpected package');
if (p.private === true) throw new Error('Package marked private');
NODE

version="$(node -p 'require("./package.json").version')"
[[ "$RELEASE_TAG" == "v$version" ]] || { echo "Tag/version mismatch" >&2; exit 2; }

git rev-parse --verify "refs/tags/$RELEASE_TAG^{commit}" >/dev/null
test "$(git rev-parse 'HEAD^{commit}')" = "$(git rev-parse "refs/tags/$RELEASE_TAG^{commit}")" || {
  echo "HEAD is not the approved release tag" >&2
  exit 2
}

if [[ "$version" == *-* ]]; then dist_tag=next; else dist_tag=latest; fi

config_file="$(mktemp)"
trap 'rm -f "$config_file"' EXIT
chmod 600 "$config_file"
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$config_file"
export NPM_CONFIG_USERCONFIG="$config_file"

node - <<'NODE'
const { execFileSync } = require('node:child_process');
const v = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim().split('.').map(Number);
if (v[0] < 11 || (v[0] === 11 && v[1] < 15)) throw new Error('npm >= 11.15 required');
NODE

npm ci --ignore-scripts --no-audit --fund=false
npm test
npm audit --omit=dev --audit-level=high
npm pack --dry-run
npm stage publish . --access public --tag "$dist_tag" --registry https://registry.npmjs.org/
