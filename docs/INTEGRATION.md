# Manual SPACE integration on a disposable VM

This is a **manual**, explicit test of the experimental native filesystem transport. It creates a **new real Firecracker VM**. It never points at an existing sandbox and never uses a real repository or company file.

## Preconditions

- Node.js 24.11 or newer on the test runner, npm dependencies installed from the committed lockfile.
- Test-runner network access to a private SPACE management API and data-plane URL on the isolated SPACE test host.
- An **isolated/development** SPACE deployment, a disposable template such as `seed:latest`, and a scoped development token. Do not use a production administrator token.
- Confirm your deployed SPACE version exposes the **Incubating** native `files:stat/list/read/write/mkdir/rename/remove` API endpoints. An older deployment may return 404. Never bypass this by enabling command-experimental mode with private files.
- The user must actively opt in. Jenkins PR builds and normal npm tests must **never** automatically create VMs.

## Run from a private shell on the isolated SPACE test host

```bash
# Set the repository clone URL privately before running this example.
: "${REPOSITORY_URL:?Set the approved Git repository clone URL}"
git clone "$REPOSITORY_URL"
cd paperclip-space-provider
# Check out the reviewed source revision:
git switch main
# Or check out the reviewed integration-test PR branch before merging.

node --version
npm ci --ignore-scripts --no-audit --fund=false
npm run build
npm test

# Substitute the URLs reachable FROM THIS TEST RUNNER.
export SPACE_API_URL='http://REPLACE_WITH_PRIVATE_SPACE_HOST:18080'
export SPACE_DATA_PLANE_URL='http://REPLACE_WITH_PRIVATE_SPACE_HOST:18090'
export SPACE_ALLOW_INSECURE_PRIVATE_HTTP=true
export SPACE_TEMPLATE='seed:latest'

# Enter token without echoing it into shell history or a console log:
read -r -s -p 'Disposable SPACE API token: ' SPACE_API_TOKEN
printf '\n'
export SPACE_API_TOKEN

# Exact opt-in; a newly created VM consumes resources.
export SPACE_INTEGRATION_CONFIRM='DISPOSABLE_VM_ONLY'
npm run test:space:integration
unset SPACE_API_TOKEN SPACE_INTEGRATION_CONFIRM
```

Only use `SPACE_ALLOW_INSECURE_PRIVATE_HTTP=true` if your sandbox provider and SPACE are on an explicitly trusted private bridge. HTTPS should be preferred otherwise. Do not paste tokens or unredacted environment output in an issue.

## Test content and expected behavior

The program creates a temporary host directory and a new Firecracker sandbox, then:

1. Creates the sandbox and a workspace inside the **new** VM.
2. Executes a real command, checks stdout, and verifies a nonzero exit code.\n3. Uploads a fully synthetic directory: text, empty file, 750-KiB binary data, and nested files. The synthetic `.git/config` fixture is intentionally excluded.
4. Downloads the guest directory to a separate local directory and verifies byte length and SHA-256 for every test fixture.
5. Downloads one guest file with an independent single-file mapping.
6. Deletes the created VM and removes temporary local test files.

A successful run prints `PASS: binary, empty, nested, excluded and single-file roundtrips`, followed by `Delete confirmed`.

## Failure handling

- If **create times out**, its outcome can be unknown. Do **not** immediately rerun the test; inspect SPACE for orphaned VMs.
- If the VM ID is printed but deletion is not confirmed, inspect/delete **only that ID** manually. Do not delete unrelated sandboxes.
- If SPACE returns 404 on a native file endpoint, deployed SPACE may be older than the upstream Incubating API. Stop and check API version; do not activate the command-based transfer fallback.
- An HTTP 200 response does not alone prove file integrity: this test compares SHA-256 of the actual downloaded content.
- Do not use this script with a production Paperclip workspace. It does **not** test the live Paperclip host/plugin handshake or prove safety against malicious concurrent file changes.

The runner deliberately refuses execution when CI, JENKINS_URL, or BUILD_ID is set, even with an override flag. Do not enable `test:space:integration` as a Jenkins job stage. This job uses live resources and a secret token; a separate explicitly approved integration environment is needed for future automation.

## Paperclip host verification (separate gate)

This test exercises the SPACE API and native sync library directly. It does **not**
prove the Paperclip worker handshake. After the disposable VM test passes:

1. Build and inspect the package with `npm run build && npm pack --dry-run`.
2. Install the reviewed package into an isolated Paperclip development instance,
   following that Paperclip version's plugin manager instructions. Never point
   a production Paperclip workspace at an alpha plugin.
3. Check that the worker loads and the `space` sandbox provider appears under
   instance environment settings. Supply private HTTPS management and data-plane
   URLs; configure the management token through Paperclip's secret mechanism.
4. Invoke the environment probe, confirm it creates, executes within and deletes
   a disposable sandbox. Inspect SPACE for orphan sandboxes after failures.
5. Exercise a synthetic one-command agent job, check logs, workspace path,
   execution exit status and lease release. Do not transfer real repositories.
6. Record Paperclip host build, SPACE deployment version and API schema,
   command transcript without secrets, and deletion confirmation.

If plugin configuration expects a resolved token but receives a secret reference,
stop and correct integration with the matching Paperclip SDK/host contract.
Do not work around this by pasting a production token into a stored config.

## The seed guest and /paperclip-workspace

The published SPACE seed image runs commands as the unprivileged `user`
(UID 2000). Although `/home/user/workspace` exists, the Paperclip plugin
contract currently uses `/paperclip-workspace`. Fresh seed guests cannot
create a directory directly under `/` without elevation.

`SpaceClient.ensureWorkspace()` verifies that the guest target is not a symlink,
checks for the exact seed user identity before any privileged initialization,
and uses the seed image's passwordless `sudo -n install -d` **only inside the
temporary Firecracker VM** to create that fixed path with mode 0700 and owner
`user:user`. Subsequent plugin jobs run as the unprivileged guest user.

Custom/production templates should instead pre-provision a private, writable
`/paperclip-workspace` owned by their normal execution user at template build
time. Such templates do not require or use the sudo bootstrap. If the guest
does not match the standard seed identity and does not already provide a
writable workspace, initialization fails closed. Never `chmod 777 /`, and
never use host-side `sudo` or a host bind mount to work around this failure.
