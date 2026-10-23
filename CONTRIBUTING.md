# Contributing

Contributions are welcome after the initial source import. Open an issue before a major API or security architecture change.

Please include tests for all lifecycle and stream-handling changes. The sandbox isolation boundary and host workspace synchronization are security-sensitive; avoid speculative changes without a threat-model discussion.

Never commit tokens, credentials, private hostnames or production configuration. PR jobs are deliberately unprivileged and cannot access npm release credentials.
