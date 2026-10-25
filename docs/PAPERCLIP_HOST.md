# Paperclip host integration on a private SPACE deployment

A disposable Firecracker VM round-trip was verified against SPACE 0.8.0 on
node02: create, stdout and nonzero command exits, native file/directory
transfers with checksums, and confirmed deletion. This does **not** prove that
Paperclip can install the plugin, resolve a company secret, or run agents.

This is a development-only alpha. Use a separate Paperclip test instance, a
scoped SPACE token, and synthetic data. Never use production repositories.

## 1. Locate the actual Paperclip server

Run on the machine that is supposed to host Paperclip:

    command -v paperclipai || true
    docker ps --format '{{.Names}} {{.Image}}' | grep -i paperclip || true
    docker compose ls

If Paperclip runs in a container, the plugin source path and both SPACE URLs
must be reachable **inside that container**. Container-local 127.0.0.1 is not
the Docker host or node02. Do not assume Paperclip is on node01 or node02.

## 2. Prepare the plugin inside the server's accessible filesystem

On the Paperclip test server, or in a dedicated mounted plugin directory
that the server can read:

    git clone https://github.com/Snyxex/paperclip-space-provider.git
    cd paperclip-space-provider
    npm ci --ignore-scripts --no-audit --fund=false
    npm run build
    npm test
    node scripts/paperclip-host-preflight.mjs

Pin a reviewed Git commit for reproducible experiments. The package is
intentionally private and not published on npm. Local installation is
supported by self-hosted Paperclip.

For a container host, arrange a dedicated persistent read-only volume
containing the built plugin, package metadata, and dependencies; use the
path **visible inside** the Paperclip server process. Never mount Docker's
socket or a host home directory to work around path errors.

## 3. SPACE network connectivity from Paperclip

On node02, SPACE listens on 127.0.0.1:8080 (management) and
127.0.0.1:8090 (data plane). Do not open these ports to 0.0.0.0 or publish
them on public Traefik routes.

- If Paperclip runs natively on node02, it can use those exact loopback URLs.
- If Paperclip runs natively on a different Linux machine, establish a
  temporary private SSH local-forward from that machine to node02:

      ssh -N -o ExitOnForwardFailure=yes \
        -L 127.0.0.1:18080:127.0.0.1:8080 \
        -L 127.0.0.1:18090:127.0.0.1:8090 \
        <ssh-user>@<node02-private-ssh-host>

  The Paperclip process on the SSH client host can now use
  http://127.0.0.1:18080 and http://127.0.0.1:18090. Supervise the
  tunnel for persistent testing; it must fail closed if disconnected.
- If Paperclip runs in Docker or Kubernetes, a host-local SSH tunnel
  is **not automatically reachable** from the plugin worker. Use a
  dedicated container-local tunnel or a private authenticated HTTPS bridge
  reachable from the server's actual network namespace. Do not switch
  a production instance to host networking solely for this test.

The provider forbids insecure HTTP to public/CGNAT addresses, even when
the allowInsecurePrivateHttp development flag is set. Tailscale's
100.64.0.0/10 address range is not RFC1918. Use authenticated HTTPS
for direct tailnet access rather than changing this protection.

## 4. Verify the actual host's path and network

Run from the Paperclip worker's runtime environment with URLs appropriate
to that environment (the example assumes a local SSH tunnel):

    export SPACE_API_URL=http://127.0.0.1:18080
    export SPACE_DATA_PLANE_URL=http://127.0.0.1:18090
    node scripts/paperclip-host-preflight.mjs --connectivity

This credential-free command verifies the compiled package, the SPACE
management OpenAPI endpoint, and data-plane TCP/TLS reachability. It does
not authenticate, access secret values, start a VM or install Paperclip.
HTTPS certificates are normally verified.

## 5. Install in a self-hosted Paperclip test instance

Using a Paperclip CLI authenticated against the **test instance**, and a
path readable from the Paperclip server:

    paperclipai plugin install --local /absolute/server-visible/paperclip-space-provider
    paperclipai plugin list
    paperclipai plugin inspect community.space-sandbox-provider

Check plugin status and logs in Settings → Plugins. The local plugin
worker is trusted host code; install only reviewed commits.

Under Settings → Instance settings → Environments, create a sandbox
environment using provider space. Set these environment fields:

| Field | Value |
| --- | --- |
| driver/provider | sandbox / space |
| apiUrl | SPACE management origin reachable from the worker |
| dataPlaneUrl | SPACE data-plane origin reachable from the worker |
| apiToken | Scoped test token stored by Paperclip as a secret |
| template | seed:latest for smoke tests |
| transferMode | disabled initially |
| reuseLease | false |
| allowInsecurePrivateHttp | false for HTTPS or loopback |

Do not expose a management token in environment files, logs, repository
history, or agent command arguments. Verify actual host secret-reference
resolution before depending on it: the direct SpaceClient test does not
validate the Paperclip host-to-plugin secret handoff.

## 6. Prove Paperclip's actual lifecycle

Use the sandbox environment's Probe action in the Paperclip test UI.
It creates/executes/deletes a **real disposable VM**. Confirm deletion
in SPACE, especially on timeout or failure; do not blindly retry
uncertain mutations.

Then execute a synthetic test job through Paperclip and check
acquire → realize workspace → execute → release. Keep transfers
disabled initially, enabling native-incubating only for artificial
files on an isolated environment. A full Codex or Claude agent job
also needs a compatible SPACE guest with its CLI/runtime installed:
seed:latest is intentionally a minimal smoke image.

Log the Paperclip version, SPACE version, successful worker startup,
secret resolution, command output, exit status, file integrity and
lease cleanup without logging tokens.

Unresolved alpha items: complete stdin support, cancellation,
uncertain-outcome reconciliation, lease expiry guarantees, security
races in native file transfer, and prepared agent templates. A live
Paperclip probe alone is not a production qualification.
