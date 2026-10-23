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
if (p.name !== '@snyxex/paperclip-space-provider') throw new Error('Unexpected package');
if (p.private === true) throw new Error('Package marked private');
NODE

version="$(node -p 'require("./package.json").version')"
[[ "$RELEASE_TAG" == "v$version" ]] || { echo "Tag/version mismatch" >&2; exit 2; }

# Release branch policy: the selected tag MUST point to the CURRENT tip of
# origin/main. This deliberately rejects tags on feature/PR branches and
# historical main commits. Worktree may be detached at the approved tag.
git fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
git fetch --no-tags origin "refs/tags/$RELEASE_TAG:refs/tags/$RELEASE_TAG"

main_commit="$(git rev-parse --verify 'refs/remotes/origin/main^{commit}')"
tag_commit="$(git rev-parse --verify "refs/tags/$RELEASE_TAG^{commit}")"
head_commit="$(git rev-parse --verify 'HEAD^{commit}')"
if [[ "$head_commit" != "$main_commit" || "$tag_commit" != "$main_commit" ]]; then
  echo "Release denied: checked-out commit AND release tag must both equal origin/main HEAD" >&2
  echo "Tag changes or historical commits are not eligible for release." >&2
  exit 2
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Release denied: tracked files in the release workspace are modified" >&2
  exit 2
fi

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
npm run build
npm test
npm audit --omit=dev --audit-level=high
npm pack --dry-run --json > /tmp/npm-space-package-"$".json
node - /tmp/npm-space-package-"$".json <<'NODE'
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))[0];
for (const expected of ['dist/manifest.js', 'dist/worker.js']) {
  if (!report.files.some(file => file.path === expected)) throw new Error('Missing package file: ' + expected);
}
NODE
rm -f /tmp/npm-space-package-"$".json
npm stage publish . --access public --tag "$dist_tag" --registry https://registry.npmjs.org/
