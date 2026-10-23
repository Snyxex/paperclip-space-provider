# Security policy

## Supported versions

No production-ready release currently exists. The alpha prototype is experimental.

## Reporting

Please avoid disclosing vulnerabilities with exploit details, credentials or private infrastructure in public GitHub issues. Contact the repository maintainer privately through GitHub's private vulnerability reporting feature if enabled. If private vulnerability reporting is not enabled, request a secure contact channel without revealing vulnerability details.

## Trust boundaries

The SPACE management API, bearer tokens, Docker socket, host files and Kubernetes credentials must never be accessible to untrusted sandbox code. Workspace transfers must validate archive paths, links and allowed destinations outside the sandbox. Do not reuse management tokens for command-stream attachment, and do not expose the Kind development deployment directly to the public Internet.

The supplied Jenkinsfile intentionally uses no secrets. npm staging requires a separate, reviewed and locked-down Jenkins release job.
