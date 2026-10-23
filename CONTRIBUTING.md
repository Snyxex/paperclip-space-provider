# Contributing

This SPACE sandbox provider is currently experimental and should not be used with production credentials or real source repositories.

Open an issue before major API or security-boundary changes. Please include tests for mutations, command streams, cancellation and workspace file transfers. VM and host files cross a trust boundary: all host-path and archive security checks must be enforced outside the VM.

Do not commit tokens, environment secrets or private infrastructure details. Branch and PR CI must never receive npm write credentials. Only a reviewed release tag on the current `main` HEAD can enter a separate, approved npm staged release.
