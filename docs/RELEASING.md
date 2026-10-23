# Jenkins + npm staged releases

## Ownership and package naming

- The GitHub repository is `Snyxex/paperclip-space-provider`, owned by the **personal** GitHub account `Snyxex`.
- Personal projects publish only under the **personal npm account** `snyxex`, using `@snyxex/*`.
- This provider's package name is **`@snyxex/paperclip-space-provider`**. Do not create an npm organization for personal projects.
- A future move into a team/company is a **separate migration**. Changing the npm scope changes the package name; publish a new scoped package, redirect consumers, and deprecate the old package only when ready. GitHub repository transfers and npm package moves are not automatically coupled.

## Branch and publication policy

**Only the current `origin/main` tip may become a new npm version.**

1. Feature branches and pull requests may run CI, but **never stage or publish packages**.
2. Merge the reviewed change into the protected `main` branch.
3. Create an annotated or lightweight release tag such as `v0.1.0-alpha.1` pointing to **the current main HEAD**, then push the tag.
4. Start a **separate, manually approved** Jenkins release job on a trusted executor. Select the tag as `RELEASE_TAG`, and check out its commit from the repository.
5. `ci/stage-npm.sh` fetches the current remote `main` and the selected remote tag, then refuses release unless `HEAD = tag commit = origin/main HEAD`. A historical main commit is not release-eligible, even if it was once main HEAD.
6. Jenkins stages the package using npm stage-only credentials. A maintainer then inspects and approves the stage using npm 2FA. Nothing can automatically go live from a branch build.

Releases may still pass through `next` for prerelease versions and `latest` for stable versions; npm dist-tags are not Git branches.

## Jenkins separation

- **Normal `Jenkinsfile`:** PR/main branch CI **without npm write credentials**. No release stage.
- **Trusted release job:** an independently configured, access-controlled, manually triggered job with **no PR discovery**. Configure the trusted release pipeline outside untrusted PR code and use a clean executor.
- The `npm-stage-only` Jenkins credential must be available **only** to the trusted release job; no secret binding in branch/PR builds.
- The release job checks out the exact `RELEASE_TAG` commit, invokes `ci/stage-npm.sh`, and binds `NPM_TOKEN` only after manual operator approval.
- Protect `main` with required reviews and CI. Restrict creating and changing `v*` tags to maintainers through GitHub repository rulesets.
- Use a clean workspace, isolated Jenkins agents and minimum GitHub credentials. Avoid sharing a credential-bearing agent with arbitrary code.
- Review scripts and package dependencies before permitting release; `npm ci --ignore-scripts` deliberately blocks install lifecycle scripts.

## npm setup

1. Confirm access to the **personal npm user account `snyxex`**, enable phishing-resistant 2FA, and verify `@snyxex` is its personal scope.
2. Include `"name": "@snyxex/paperclip-space-provider"` and `"publishConfig": {"access": "public", "registry": "https://registry.npmjs.org/"}` in the package metadata when source is imported.
3. Use Node.js >= 24.11.0 and npm CLI >= 11.15.0 on the release executor.
4. Create a narrowly scoped, short-lived **Read and write (stage only)** granular access token (prefer restriction to this specific package once it exists). Store as Jenkins **Secret text**, ID `npm-stage-only`.
5. Keep the token out of `.npmrc` checked into source, Jenkins job logs, shell history and source files.

Stage-only tokens still have some non-publish write privileges, including deprecations and dist-tag changes. Protect them as sensitive credentials.

## Release job steps

Create a dedicated Jenkins Pipeline job (not the repo's `Jenkinsfile` PR pipeline). Use a trusted, admin-managed pipeline definition and these logical steps:

1. Require `RELEASE_TAG` and an operator approval.
2. Check out the approved tag in a fresh checkout of `https://github.com/Snyxex/paperclip-space-provider.git`.
3. Make `NPM_TOKEN` available only around the `ci/stage-npm.sh` invocation. The script performs the **current main** and package-name checks before staging.
4. Review the staged version using `npm stage list`, `npm stage view <stage-id>` or `npm stage download <stage-id>` and approve with npm 2FA.

The script is intentionally fail-closed if `main` advances after the tag was created. Create a new reviewed release tag on the new main HEAD as needed; never move published tags.

## Status

The provider source, `package.json` and lockfile still need to be imported. **Neither Jenkins release publishing nor npm publication is currently enabled or tested.**

npm references:
- https://docs.npmjs.com/staged-publishing/
- https://docs.npmjs.com/about-access-tokens/
- https://docs.npmjs.com/about-scopes/
