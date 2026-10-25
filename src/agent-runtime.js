/**
 * Opt-in, command-only checks for disposable SPACE agent runtimes.
 * These checks establish tool presence, not provider authentication or production readiness.
 * No user-controlled strings are interpolated into the guest shell script.
 */
const BINARY_SETS = Object.freeze({
  'node-tooling': ['node', 'git', 'tar'],
  codex: ['node', 'git', 'tar', 'codex'],
});

export const RUNTIME_PROFILES = Object.freeze(['none', ...Object.keys(BINARY_SETS)]);

export async function assertAgentRuntimeReady(client, sandboxId, profile = 'none') {
  if (!RUNTIME_PROFILES.includes(profile)) throw new Error('Invalid SPACE agent runtime profile');
  if (profile === 'none') return {checked: false};

  const required = BINARY_SETS[profile];
  const lines = ['set -eu'];
  for (const binary of required) {
    lines.push(`if ! command -v ${binary} >/dev/null 2>&1; then printf 'MISSING:${binary}\\n'; exit 64; fi`);
    lines.push(`if ! ${binary} --version >/dev/null 2>&1; then printf 'BROKEN:${binary}\\n'; exit 65; fi`);
  }
  lines.push("if ! node -e 'process.exit(Number(process.versions.node.split(\".\")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1; then printf 'UNSUPPORTED:node\\n'; exit 65; fi");
  const marker = `paperclip-space-runtime-ready:${profile}`;
  lines.push(`printf '%s' '${marker}'`);

  const result = await client.exec(sandboxId, 'sh', ['-c', lines.join('\n')], {
    timeoutMs: Math.min(30_000, client.config.timeoutMs),
  });
  if (result.exitCode === 0 && result.stdout?.trim() === marker) {
    return {checked: true, profile};
  }
  const reported = /^(MISSING|BROKEN|UNSUPPORTED):([a-z0-9_-]+)$/m.exec(result.stdout ?? '');
  if (reported && required.includes(reported[2])) {
    throw new Error(`SPACE agent runtime '${profile}' rejected: ${reported[1].toLowerCase()} ${reported[2]}; prepare the selected SPACE template before starting an agent`);
  }
  throw new Error(`SPACE agent runtime '${profile}' check failed (${Number.isInteger(result.exitCode) ? `exit ${result.exitCode}` : 'unknown exit'}); no agent was started`);
}
