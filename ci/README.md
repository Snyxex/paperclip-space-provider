# Jenkins agents and trust separation

Configure Jenkins Multibranch Pipeline for this repository, with Jenkins
NodeJS installation named `NodeJS-24`.

- `npm-ci`: Linux Node.js agent for PRs and branches, no secrets, no Docker
  socket, no privileged containers.
- `docker-test`: ephemeral, **trusted main-only** Linux executor with Docker
  Engine and CLI. No npm tokens or SPACE credentials, no production mounts,
  clean workspace and isolated daemon. Do not use this label for PR execution.
- `npm-release`: separate admin-managed trusted executor, explicitly approved
  tag only. Use `ci/Jenkinsfile.release.example`; never load it from a PR.

On the Docker agent, set `docker-test` label and verify `docker info`.
Hardware virtualization and a deployed SPACE cluster are **not** installed
by this CI stage; provision those separately for manual integration tests.

Set GitHub webhooks for branch/PR indexing, protect main with required
checks, and verify Jenkins records the Docker stage as passing before release.
No credential must be injected into untrusted branch or Docker test jobs.
