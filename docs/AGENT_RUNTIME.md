# Paperclip-driven Firecracker agent readiness and synthetic Node test

Status: **experimental, isolated test environments only**. This is a follow-up
to a successful Paperclip-managed SPACE create/execute/delete probe. It is **not**
a complete Codex or Claude agent execution integration.

## Capabilities

A SPACE environment can now opt into a runtime check with `runtimeProfile`:

- `none` (default): unchanged existing behavior.
- `node-tooling`: verify executable `node` (Node.js 20+), `git`, and `tar`.
- `codex`: the same tools plus a working `codex --version`.
  **Codex login, model access, network access, and agent-task execution are not verified**.

If the selected profile is not present in the VM, the plugin fails early on
lease acquisition and attempts to delete the VM. A failure to confirm deletion
is reported explicitly; an operator must reconcile uncertain outcomes.

An optional `probeScenario: node-file-test` in the environment edit form
uses the plugin's Paperclip `onEnvironmentProbe` hook to:

1. Provision a fresh SPACE Firecracker VM and make `/paperclip-workspace` writable.
2. Verify the selected agent-runtime toolchain.
3. Write a *fixed, credential-free* Node.js test file through SPACE's
   **incubating** native filesystem API, with a per-request idempotency key.
4. Read the file back and check exact binary integrity.
5. Run `node --test` in the VM and check the exit code and TAP output.
6. Delete the VM and wait for SPACE to confirm deletion.

No user-provided code, secrets or repositories are transferred by this probe.
It does **not** make native file sync production-safe; see [Native sync](NATIVE_SYNC.md).

## SPACE template preparation on an isolated Kind deployment

The minimal `seed:latest` is suitable for shell smoke tests but need not include
Node.js, Git, or Codex. SPACE's maintained **code-runtime** system template
includes Node.js and development tools. Follow its
[build and publish procedure](https://github.com/perplexityai/SPACE/blob/main/templates/firecracker/seed/README.md)
using a SPACE admin session. A typical command, with `space-admin-cli`
installed and `SPACE_API_URL` and `SPACE_API_TOKEN` configured for your own
local admin endpoint, is:

```bash
space-admin-cli template build code-runtime --publish-tag latest
```

Do **not** rebuild the seed or publish a shared cluster template without
operator approval. First confirm the template is available for your test VM.

The maintained `code-runtime:latest` image does not guarantee a Codex CLI.
Use `runtimeProfile: node-tooling` for the first end-to-end file/run probe.
To test `runtimeProfile: codex`, first prepare and publish a reviewed
Codex-capable template. The profile is a *prerequisite check*, not an installer.

## Paperclip test Environment configuration

Create a dedicated environment instead of modifying the default used by
production agents:

| Field | Value |
| --- | --- |
| `driver` / `provider` | `sandbox` / `space` |
| `apiUrl` | Existing private SPACE management origin |
| `dataPlaneUrl` | Existing private SPACE data-plane origin |
| `apiToken` | SPACE session credential bound as a Paperclip company secret |
| `template` | `code-runtime:latest` after publication |
| `runtimeProfile` | `node-tooling` |
| `transferMode` | `native-incubating` (test only) |
| `probeScenario` | `node-file-test` |
| `reuseLease` | `false` |

The new `probeScenario` requires both native-incubating transfer and a
non-`none` runtime profile. Keep `allowInsecurePrivateHttp` enabled **only**
for a private single-host development bridge; use authenticated TLS otherwise.

In Paperclip, edit this environment and click **Test** at the bottom of the
form. This invokes the provider-specific probe with the draft values.
The separate **Test provider** button in the environment list validates lease
acquisition and cleanup, not this extended file round trip.

Expected result:

```text
SPACE created a Firecracker sandbox, transferred and ran a synthetic Node test, and deleted it
```

After the test, use SPACE's management API to verify no unintended sandboxes
remain. On a dedicated empty test cluster, `GET /v1/sandboxes?limit=50`
should return `{"data":[]}` (other instances can legitimately appear).

## Development and deployment

Jenkins is the CI system. The branch must pass `npm ci`, `npm run build`,
`npm test`, the Paperclip host preflight and package checks **before** review
and merge. Jenkins and ordinary unit tests must never receive live SPACE
tokens or start live VMs.

For a reviewed, merged commit on the Paperclip host (the existing plugin source
is mounted read-only into the Paperclip container):

```bash
cd /root/paperclip-space-provider
git fetch origin
git checkout main
git pull --ff-only origin main
npm ci --ignore-scripts --no-audit --fund=false
npm run build
npm test
```

Reload the installed plugin using Paperclip's supported plugin lifecycle and
confirm it is `ready`. If necessary, restart only the Paperclip service during
the test maintenance window, then inspect the plugin; avoid uninstalling a
plugin bound to an existing environment. The source changes above alone
**do not hot-reload a running Paperclip worker**.

Do not enable `node-file-test` until the updated plugin is loaded and the
`code-runtime` template is published.

## Still missing for a real agent-run guarantee

- Verified Paperclip agent adapter execution, including Codex/Claude login
  and model permissions in a disposable VM.
- Safe, transactional repository workspace synchronization, with adversarial
  symlink/race review.
- Robust stdin/duplex process execution, cancellation and recovery of uncertain
  completion states.
- Full cleanup/reconciliation and lease expiry guarantees.
- Installation and qualification of a real Codex-capable template.

Do not use sensitive repositories, customer code, or production secrets in
this experimental plugin until those gaps are closed.
