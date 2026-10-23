# Paperclip ↔ SPACE integration qualification

The repository's unit/protocol tests use mocks. Docker CI executes the same source
tests in a clean Node.js container: it does **not** emulate Firecracker, run a
SPACE control plane, or prove compatibility with a Paperclip host.

## Trusted environments

1. **PR builds:** credential-free Node tests, static checks, and package inspection.
2. **Main branch:** the same checks plus a dedicated disposable Docker build agent.
   Docker daemon/socket access is root-equivalent. Never run arbitrary PR code on
   a persistent Jenkins agent with Docker socket access or production mounts.
3. **Manual integration:** separate disposable host with hardware virtualization
   (KVM), pinned SPACE build, and isolated Paperclip instance. Bind a scoped SPACE
   token only to the trusted job, never to Docker build layers or PR jobs.
4. **Release:** requires reviewed main tag, security sign-off, successful real
   integration evidence, and human approval in a separate release job.

## Acceptance matrix for live integration

- Deploy SPACE, verify health, version, advertised API, and Firecracker/KVM support.
- Install local packed plugin into a matching Paperclip host and register the driver.
- Create VM, inspect readiness, run stdout/stderr commands, verify exit codes.
- Test nonzero exits, streaming interruptions, timeout, cancellation, process
  recovery and unknown outcomes; ensure orphan resources are reconciled.
- Exercise binary and nested workspace sync, excludes, permission boundaries,
  symlinks/hardlinks, race scenarios, size caps, and interrupted transfers.
- Confirm sandbox cannot read SPACE management tokens or host credentials.
- Run multiple concurrent jobs, check capacity limits, metrics and full cleanup.
- Restart Paperclip and SPACE under load and test recovery/lease ownership.
- Repeat tests against supported Paperclip and SPACE versions and record results.

Known blockers: stdin, full process cancellation, reliable lease expiry,
end-to-end production workspace sync and host integration are incomplete.
Do not turn on production credentials or publish a stable release until closed.

## Local Docker verification

```sh
bash ci/docker-test.sh
```

This requires a working Docker daemon. The build downloads npm dependencies,
runs tests during image creation and reruns tests in a network-disabled,
read-only container. It does not require a SPACE token or server.
