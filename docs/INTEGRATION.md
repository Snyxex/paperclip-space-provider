# Disposable native SPACE integration test (node02)

This is a **manual**, explicit test of the experimental native filesystem transport. It creates a **new real Firecracker VM**. It never points at an existing sandbox and never uses a real repository or company file.

## Preconditions

- Node.js 24.11 or newer on the test runner, npm dependencies installed from the committed lockfile.
- Test-runner network access to a private SPACE management API and data-plane URL on node02.
- An **isolated/development** SPACE deployment, a disposable template such as `seed:latest`, and a scoped development token. Do not use a production administrator token.
- Confirm your deployed SPACE version exposes the **Incubating** native `files:stat/list/read/write/mkdir/rename/remove` API endpoints. An older deployment may return 404. Never bypass this by enabling command-experimental mode with private files.
- The user must actively opt in. Jenkins PR builds and normal npm tests must **never** automatically create VMs.

## Run from a private shell on node02

```bash
git clone https://github.com/Snyxex/paperclip-space-provider.git
cd paperclip-space-provider
# Test the exact PR #9 source while it is still under review:
git fetch origin pull/9/head:integration-pr9
git switch integration-pr9

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
2. Uploads a fully synthetic directory: text, empty file, 750-KiB binary data, and nested files. The synthetic `.git/config` fixture is intentionally excluded.
3. Downloads the guest directory to a separate local directory and verifies byte length and SHA-256 for every test fixture.
4. Downloads one guest file with an independent single-file mapping.
5. Deletes the created VM and removes temporary local test files.

A successful run prints `PASS: binary, empty, nested, excluded and single-file roundtrips`, followed by `Delete confirmed`.

## Failure handling

- If **create times out**, its outcome can be unknown. Do **not** immediately rerun the test; inspect SPACE for orphaned VMs.
- If the VM ID is printed but deletion is not confirmed, inspect/delete **only that ID** manually. Do not delete unrelated sandboxes.
- If SPACE returns 404 on a native file endpoint, deployed SPACE may be older than the upstream Incubating API. Stop and check API version; do not activate the command-based transfer fallback.
- An HTTP 200 response does not alone prove file integrity: this test compares SHA-256 of the actual downloaded content.
- Do not use this script with a production Paperclip workspace. It does **not** test the live Paperclip host/plugin handshake or prove safety against malicious concurrent file changes.

Do not enable `test:space:integration` as a Jenkins job stage. This job uses live resources and a secret token; a separate explicitly approved integration environment is needed for future automation.
