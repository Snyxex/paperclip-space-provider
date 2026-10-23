# Paperclip SPACE Provider

Open-source integration for running [Paperclip AI](https://github.com/paperclipai/paperclip) agent workloads in [Perplexity SPACE](https://github.com/perplexityai/SPACE) Firecracker microVM sandboxes.

> **Status: pre-release / experimental.** The original `0.1.0-alpha.1` prototype was tested locally against SPACE, but is not yet uploaded to this repository or validated for production. Do not install it on a production Paperclip instance.

## Project goals

- Use Paperclip's documented `sandbox_provider` plugin interface, without patching Paperclip.
- Self-host the sandbox control plane and Firecracker workers.
- Support sandbox lifecycle, commands, live streams, safe workspace synchronization, quotas and cleanup.
- Keep SPACE management credentials outside sandboxes and outside source control.

## Current status

- Public repository and secure Jenkins CI/release scaffolding are established.
- Provider source, complete workspace synchronization, Codex-ready template and end-to-end integration tests are **not yet published here**.
- No npm release has been created or authorized.

## CI and publishing

The normal `Jenkinsfile` runs **without credentials**. It intentionally requires `package.json` and a committed `package-lock.json`; before the provider source is added, CI is not ready to pass.

A separate, trusted Jenkins release job can invoke `ci/stage-npm.sh` for a protected and reviewed Git tag. It must use an npm **stage-only** token and an isolated executor. Jenkins stages the package; a human reviews and approves the staged version with npm 2FA. **Never give npm credentials to pull-request jobs.**

Read [Release & Jenkins setup](docs/RELEASING.md) before configuring the release job.

## Development

Use Node.js >= 24.11.0, a compatible npm CLI and Paperclip plugin SDK. The provider source and lockfile must be added before running:

```bash
npm ci
npm test
npm pack --dry-run
```

## Security

Report suspected security vulnerabilities privately using the process in [SECURITY.md](SECURITY.md). Do not create public issues containing secrets, tokens, exploit payloads or private infrastructure details.

## License

Apache-2.0. The provider is an independent community project and is not an official Paperclip or Perplexity product.
