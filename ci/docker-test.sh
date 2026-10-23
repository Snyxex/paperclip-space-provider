#!/usr/bin/env bash
set -Eeuo pipefail
# Only run on a dedicated, disposable Jenkins Docker worker without credentials.
# Docker access is root-equivalent; never expose its socket to untrusted PR jobs.
command -v docker >/dev/null || { echo "Docker CLI unavailable" >&2; exit 1; }
docker info >/dev/null
image="paperclip-space-provider-ci:${BUILD_NUMBER:-local}-$$"
trap 'docker image rm -f "$image" >/dev/null 2>&1 || true' EXIT
docker build --pull --no-cache --progress=plain -f ci/Dockerfile.test -t "$image" .
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=64m --pids-limit 128 --memory 1g --cpus 2 "$image"
