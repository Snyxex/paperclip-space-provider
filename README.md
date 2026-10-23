# Paperclip SPACE Provider

Community-maintained integration between [Paperclip AI](https://github.com/paperclipai/paperclip) and [Perplexity SPACE](https://github.com/perplexityai/SPACE), using isolated Firecracker microVM sandboxes.

**Status: experimental alpha — not ready for production or real source repositories.** This source release is not yet published on npm. The production workspace synchronization, process cancellation, stdin and persistent session features remain incomplete.

> Independent project; not officially affiliated with Paperclip AI or Perplexity.

## Features currently implemented

- Paperclip plugin manifest, worker, and sandbox-provider hooks
- SPACE sandbox create/inspect/delete and readiness polling
- Command execution with bounded timeouts and command-stream attachment
- SSE stdout/stderr decoding with separate short-lived stream token
- No blind replay of mutations if the outcome is unknown
- Configurable API/data-plane endpoints, no server-specific URLs

**Not yet supported for production:** fully verified workspace transfer, stdin, complete process cleanup after interrupted streams, guaranteed lease expiration, reusable/suspendable sandboxes, prepared Codex/Claude agent images, full Paperclip host integration.

### Experimental workspace file transfer (OFF by default)

The older, explicitly unsafe development option `transferMode: command-experimental` enables `onEnvironmentSyncIn`/`onEnvironmentSyncOut` for **regular individual files**. It transfers base64 data in SPACE command requests or command output. **Command payloads may be retained or logged by the SPACE control plane: never enable this mode for secrets, credentials, company data, or production repositories.**

Safety limits: only files inside `workspace.localPath` and `/paperclip-workspace`; no symlinks, `..` traversal, directories, post-upload commands or automatic retries; maximum **256 KiB per file, 64 files, 4 MiB per sync request**. Exports use a temporary file and atomic rename within the allowed host workspace. These guards do not make this experimental transport production-ready.

SPACE's newer public API includes **incubating native filesystem endpoints** (POST `files:stat/list/read/write/mkdir/rename/remove`). The new `transferMode: native-incubating` option supports bounded regular-file and recursive-directory mappings with an authenticated SPACE management API. Uploads use JSON base64 file bodies (not shell commands); downloads stream binary `application/octet-stream`. It performs lexical path confinement, local symlink/hardlink checks, guest stat checks, guest staging and rename, and temporary host downloads. Files are limited to 16 MiB each, requests to 64 MiB/512 files, and recursion to 24 levels. Exclude globs are supported; post-upload commands and symlink following are not yet supported.

**This mode remains preproduction:** the SPACE file APIs are marked *Incubating*, the deployed SPACE version in the integration environment is unverified, concurrent filesystem mutation remains a potential TOCTOU risk, and real Paperclip host integration has not been tested. Partial directory operations are not transactional. Do not use untrusted tenant repositories or production credentials yet. See [Native sync security and integration checklist](docs/NATIVE_SYNC.md).

For all normal deployments, leave `transferMode: disabled`. Never set `command-experimental` with credentials or private data.

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
| `transferMode` | `disabled` (default), `native-incubating` (native SPACE API, preproduction), or `command-experimental` (unsafe shell-payload POC) |

Use HTTPS for network-separated deployments. Do not expose SPACE Kind development credentials or ports publicly, and do not put the management bearer token inside a sandbox.

## Public and self-hosted setup

This is a community-maintained source project: no hosted instance, maintainer account, private registry, or personal domain is required. Each operator supplies their own SPACE management and stream origins and stores the API token as a Paperclip secret. See [generic example configuration](examples/config.example.json). The example domains are intentionally non-resolvable; replace them with your own HTTPS endpoints. Never commit real token values.

The repository includes a credential-free public-source hygiene check (`npm run check:public`). It flags common committed token formats, private-key headers, URL credentials and non-example email addresses. It is a defense-in-depth check, **not** a guarantee that the current repository or its Git history contains no sensitive information. Review the full Git history and rotate any credentials exposed in past commits before public redistribution. Git commit authorship and repository ownership are GitHub metadata and cannot be anonymized by editing source files.

## Development

```bash
npm run check:public
npm run build
npm test
npm pack --dry-run
```

These commands run protocol-level tests with mocked SPACE responses. They do not prove runtime compatibility or fully validate package dependencies. A committed `package-lock.json` is present; future release metadata changes must keep it synchronized.

The optional `node examples/smoke.mjs` test **creates a real VM** and requires `SPACE_API_URL`, `SPACE_DATA_PLANE_URL`, and `SPACE_API_TOKEN` from a disposable installation. For an isolated private HTTP bridge, also set `SPACE_ALLOW_INSECURE_PRIVATE_HTTP=true`.

## npm and Jenkins

- The repository is intended to be independent of individual developer accounts or infrastructure.
- Development package identifier: `paperclip-space-provider`. The package is **private** and cannot currently be published.
- Before any distribution, maintainers must select an npm scope they control and update package metadata, lockfile, tests and the separately approved release pipeline.
- Pull requests and branch builds run credential-free Jenkins CI. A release is only eligible from a reviewed tag at the current `main` HEAD, after an explicit approval and npm 2FA. No direct automated publication.

See [Release instructions](docs/RELEASING.md), [Security policy](SECURITY.md), and [Contributing](CONTRIBUTING.md).

## Roadmap

- [x] Fail-closed, opt-in experimental single-file sync and path/symlink tests
- [x] Bounded native SPACE file/directory sync, behind explicit preproduction opt-in
- [ ] Full production qualification: adversarial filesystem/TOCTOU review, real SPACE Firecracker VM and Paperclip host integration, cancellation and failure recovery
- [ ] Stdin transfer, process cancellation, cleanup/reconciliation after unknown outcomes
- [ ] Lease ownership, resource isolation, cleanup and recovery
- [ ] Codex-capable Firecracker template
- [ ] Verified current Paperclip SDK/plugin-host compatibility and integration tests
- [ ] Complete supply-chain review, select an organization-owned package scope and approve the production release gate

## License

Apache-2.0, see [LICENSE](LICENSE).
