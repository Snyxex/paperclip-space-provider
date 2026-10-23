# Jenkins agents and trust separation

Configure Jenkins Multibranch Pipeline for this repository, with Jenkins
NodeJS installation named `NodeJS-24`.

- `npm-ci`: Linux Node.js agent for PRs and branches, no secrets, no Podman
  socket, no privileged containers.
- `podman-test`: ephemeral, **trusted main-only** Linux executor with Podman
  Engine and CLI. No npm tokens or SPACE credentials, no production mounts,
  clean workspace and isolated daemon. Do not use this label for PR execution.
- `npm-release`: separate admin-managed trusted executor, explicitly approved
  tag only. Use `ci/Jenkinsfile.release.example`; never load it from a PR.

On the Podman agent, set `podman-test` label and verify `podman info`.
Hardware virtualization and a deployed SPACE cluster are **not** installed
by this CI stage; provision those separately for manual integration tests.

Set GitHub webhooks for branch/PR indexing, protect main with required
checks, and verify Jenkins records the Podman stage as passing before release.
No credential must be injected into untrusted branch or Podman test jobs.

The agent is a separate Linux VM/host with a non-root Jenkins service account, rootless Podman, subuid/subgid mappings, and Jenkins Remoting over an authenticated connection. Do not mount any container engine socket into Jenkins controller. Block production network access from this executor; use one executor per worker and wipe it between trust domains.
