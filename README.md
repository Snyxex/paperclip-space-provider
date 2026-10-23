# Paperclip SPACE Provider

Community-maintained integration between [Paperclip AI](https://github.com/paperclipai/paperclip) and [Perplexity SPACE](https://github.com/perplexityai/SPACE), using isolated Firecracker microVM sandboxes.

**Status: experimental alpha — not ready for production or real source repositories.** This source release is not yet published on npm. The secure workspace synchronization, process cancellation, stdin and persistent session features are incomplete.

> Independent project; not officially affiliated with Paperclip AI or Perplexity.

## Features currently implemented

- Paperclip plugin manifest, worker, and sandbox-provider hooks
- SPACE sandbox create/inspect/delete and readiness polling
- Command execution with bounded timeouts and command-stream attachment
- SSE stdout/stderr decoding with separate short-lived stream token
- No blind replay of mutations if the outcome is unknown
- Configurable API/data-plane endpoints, no server-specific URLs

**Not yet supported:** workspace file transfers, stdin, complete process cleanup after interrupted streams, guaranteed lease expiration, reusable/suspendable sandboxes, prepared Codex/Claude agent images, full Paperclip host integration.

## Requirements

Node.js 24.11+ for the eventual Paperclip worker, a compatible Paperclip plugin host and self-hosted SPACE cluster. The built-in SPACE `seed:latest` template is for smoke testing; agent execution requires a prepared VM image with Node.js, shell, tar, and the selected agent CLI.

## Environment configuration

Install an approved version through Paperclip's **Settings → Plugins**, then select the **SPACE** environment provider. Alpha is **not installable as a production-ready package yet**.

| Config key | Description |
| --- | --- |
| `apiUrl` | Base origin of the SPACE management API |
| `dataPlaneUrl` | Base origin of SPACE's command event stream API |
| `apiToken` | SPACE management credential stored as a Paperclip secret |
| `template` | SPACE template reference, defaults to `seed:latest` |
| `timeoutMs` | Request deadline, default 300000 |
| `allowInsecurePrivateHttp` | Explicit opt-in for single-host private RFC1918 IPv4 HTTP connections |
| `reuseLease` | Must remain `false` for this alpha |

Use HTTPS for network-separated deployments. Do not expose SPACE Kind development credentials or ports publicly, and do not put the management bearer token inside a sandbox.

## Development

```bash
npm run build
npm test
npm pack --dry-run
```

These commands run protocol-level tests with mocked SPACE responses. They do not prove runtime compatibility or fully validate package dependencies. A reviewed `package-lock.json` must be generated and committed before release.

The optional `node examples/smoke.mjs` test **creates a real VM** and requires `SPACE_API_URL`, `SPACE_DATA_PLANE_URL`, and `SPACE_API_TOKEN` from a disposable installation. For an isolated private HTTP bridge, also set `SPACE_ALLOW_INSECURE_PRIVATE_HTTP=true`.

## npm and Jenkins

- GitHub: [Snyxex/paperclip-space-provider](https://github.com/Snyxex/paperclip-space-provider)
- Personal npm scope: **`@snyxex/paperclip-space-provider`** (not `@snyxe/*`)
- Pull requests and branch builds run credential-free Jenkins CI.
- **Only a reviewed release tag at the current `main` HEAD** can be staged by the separately approved release job.
- npm staged publishing requires a maintainer's subsequent 2FA approval. No automated direct publish.
- A future transfer to a team is a deliberate GitHub and npm package migration.

See [Release instructions](docs/RELEASING.md), [Security policy](SECURITY.md), and [Contributing](CONTRIBUTING.md).

## Roadmap

- [ ] Source and workspace archive synchronization with symlink/path validation
- [ ] Stdin transfer, process cancellation, cleanup/reconciliation after unknown outcomes
- [ ] Lease ownership, resource isolation, cleanup and recovery
- [ ] Codex-capable Firecracker template
- [ ] Verified current Paperclip SDK/plugin-host compatibility and integration tests
- [ ] Dependency lockfile, supply-chain review and production release gate

## License

Apache-2.0, see [LICENSE](LICENSE).
