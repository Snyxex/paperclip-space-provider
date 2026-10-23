# Jenkins + npm staged releases

## Important boundaries

- **Normal Jenkinsfile:** untrusted PR/branch CI. It MUST NOT have npm write credentials.
- **Release job:** separately configured, manual and trusted. It may access the npm stage-only token only after the source and tag have been reviewed.
- **npm account:** use an npm organization or account that owns the `@snyxe` scope. This GitHub repository belongs to `Snyxex`; GitHub owner and npm scope need not match.
- **Node:** >= 24.11.0. **npm CLI:** >= 11.15.0 is needed for staged publishing.
- **npm OIDC Trusted Publishing:** not supported directly for self-hosted Jenkins as of October 2026.

## One-time setup

1. Create or verify `@snyxe` at npmjs.com; enable phishing-resistant 2FA for maintainers.
2. Add provider sources, `package.json` with `name: @snyxe/paperclip-space-provider`, Apache-2.0 license metadata, and a reviewed `package-lock.json`.
3. In Jenkins, provision an isolated `npm-ci` executor with Node.js 24.11+ and npm 11.15+; enable GitHub webhooks and PR validation.
4. Configure public repository protections: require PR review and successful CI on `main`; protect release tags `v*`.
5. Define one trusted, separate Jenkins release job. Disable PR discovery, SCM changes of its job definition and access from untrusted users. Check out only an explicitly reviewed protected tag.
6. Create an npm **granular stage-only** token scoped as narrowly as npm permits and with short expiry. Save as Jenkins **Secret text**, ID `npm-stage-only`, accessible only to the release job.
7. The release job invokes `ci/stage-npm.sh` with `RELEASE_TAG=vX.Y.Z` and the token bound to `NPM_TOKEN`. Do not enable automatic publishing.
8. The package is only staged. Review `npm stage list` and the npm website; approve with maintainer 2FA after inspecting its contents.

## Release-job guardrails

- Keep Jenkins credentials separate from source control; never expose them to forked PRs or untrusted jobs.
- Ensure the release executor is disposable, isolated and not shared with arbitrary users.
- Make the release job require an operator approval *before* injecting credentials.
- Use a clean workspace, secure agent labels and verified Git tag/commit.
- The supplied release script uses a temporary, mode-0600 `.npmrc` and removes it on exit.
- `stage-only` tokens **can still change dist-tags and deprecate package versions**; they are not a general write-scope boundary.
- Review npm lifecycle scripts, transitive dependencies and exact package files before activating this workflow.
- Never install a sandbox plugin from a pull request into a production Paperclip instance.

## Status / blockers

The repository currently contains the CI and release files only. **There is no approved npm package to publish yet.** Complete plugin source, signed-off package metadata, lockfile, secure workspace file synchronization, sandbox security review and Paperclip integration tests before staging a public version.

Official npm docs: https://docs.npmjs.com/staged-publishing/ and https://docs.npmjs.com/about-access-tokens/.
