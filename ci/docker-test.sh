#!/usr/bin/env bash
set -Eeuo pipefail
# Only run on a dedicated, disposable Jenkins Podman worker without credentials.
# Rootless Podman runs on an isolated, disposable build host. No Docker daemon or socket is required.
command -v podman >/dev/null || { echo "Podman CLI unavailable" >&2; exit 1; }
[ "$(id -u)" -ne 0 ] || { echo "Refuse root Podman execution" >&2; exit 1; }
podman info >/dev/null
image="paperclip-space-provider-ci:${BUILD_NUMBER:-local}-$$"
trap 'podman image rm -f "$image" >/dev/null 2>&1 || true' EXIT
podman build --pull=always --no-cache -f ci/Dockerfile.test -t "$image" .
podman run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=64m --pids-limit 128 --memory 1g --cpus 2 "$image"
