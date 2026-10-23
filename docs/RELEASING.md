# Jenkins and npm staged releases

## Neutral project identity

The source tree must not contain a personal GitHub handle, npm username, email address, hostname, or private infrastructure URL.

The development package identifier is **`paperclip-space-provider`** and `package.json` has **`"private": true`**. The package is deliberately **not publishable** in this state. The repository location is configured externally by an administrator, not committed in the release pipeline.

Before an independently reviewed release, an authorized maintainer must choose a scoped npm package name under an account or organization they control (for example, `@organization/paperclip-space-provider`, where `organization` is an explicitly substituted placeholder). Update `package.json`, `package-lock.json`, CI checks, and any distribution metadata as one reviewed change. There is no implicit or automatic npm scope migration.

## Branch and publication policy

Only the **current origin/main HEAD** may become a release.

1. Branches and pull requests run credential-free Jenkins CI and must never receive npm write credentials.
2. Merge reviewed code into the protected `main` branch after successful checks.
3. Create and push an annotated or lightweight version tag (for example `v0.1.0-alpha.1`) at the **current `main` commit**.
4. Start a separate, access-controlled Jenkins release job on a trusted executor. It must be managed outside the repository's untrusted pull-request jobs.
5. Require a human approval before binding credentials.
6. The staging script refuses release unless `HEAD = release tag = origin/main HEAD` and package metadata matches an **explicitly configured** `EXPECTED_NPM_PACKAGE`.
7. npm staging and final approval remain separate human-reviewed actions; never automatically publish from branch builds.

## Trusted release job configuration

`ci/Jenkinsfile.release.example` is a template, **not** a job for PR discovery. The administrator must configure these values in a trusted job environment, not as untrusted PR content or arbitrary user-provided build parameters:

- `RELEASE_REPOSITORY_URL`: the actual approved Git repository URL; no account-specific URL is embedded in source.
- `EXPECTED_NPM_PACKAGE`: the reviewed scoped package name matching `package.json`; must end in `/paperclip-space-provider`.
- `npm-stage-only`: a Jenkins **Secret text** credential containing a narrowly scoped npm token for the reviewed package. Only the trusted job may access it.
- `RELEASE_TAG`: the reviewed version tag, supplied only to the protected release job.
- Node.js >=24.11 and npm >=11.15; a fresh dedicated release executor with no untrusted jobs.

The exact package name is intentionally not configured until the project has an authorized distribution owner. `ci/stage-npm.sh` fails closed when the metadata is still private, the scope is absent, or `EXPECTED_NPM_PACKAGE` does not match.

Stage-only tokens can retain sensitive write capabilities. Keep them out of the repository, shell history, logs, ordinary Jenkins jobs and shared workspaces.

## Manual staging review

1. Confirm the branch and tag match and the release scope is controlled by the maintainers.
2. Review dependency licenses, security audit, workspace-transfer safety and integration results.
3. Trigger the separate job for `RELEASE_TAG` and approve npm staging.
4. Inspect the staged version using `npm stage list`, `npm stage view <stage-id>` or `npm stage download <stage-id>`.
5. Approve public release manually with the required npm 2FA only when the package has passed the release gates.

Never move a published tag or bypass the `main` tip requirement. No real-VM SPACE integration, production security review, or approved release has occurred yet.

## References

- https://docs.npmjs.com/staged-publishing/
- https://docs.npmjs.com/about-access-tokens/
- https://docs.npmjs.com/about-scopes/
