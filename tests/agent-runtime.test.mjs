import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAgentRuntimeReady, RUNTIME_PROFILES} from '../src/agent-runtime.js';

function fakeClient(exitCode, stdout) {
  const calls = [];
  return {
    config: {timeoutMs: 300_000},
    calls,
    async exec(...args) {
      calls.push(args);
      return {exitCode, stdout};
    },
  };
}

test('runtime checks are opt-in, preserving existing seed:latest probes', async () => {
  const client = fakeClient(0, '');
  assert.deepEqual(await assertAgentRuntimeReady(client, 'sbx_test'), {checked:false});
  assert.deepEqual(client.calls, []);
});

test('node-tooling preflight executes only fixed checks in disposable SPACE VM', async () => {
  const client = fakeClient(0, 'paperclip-space-runtime-ready:node-tooling');
  assert.deepEqual(await assertAgentRuntimeReady(client, 'sbx_test', 'node-tooling'), {checked:true, profile:'node-tooling'});
  const [id, command, args, options] = client.calls[0];
  assert.equal(id, 'sbx_test');
  assert.equal(command, 'sh');
  assert.equal(args[0], '-c');
  assert.match(args[1], /command -v node/);
  assert.match(args[1], /command -v git/);
  assert.match(args[1], /command -v tar/);
  assert.doesNotMatch(args[1], /command -v codex/);
  assert.deepEqual(options, {timeoutMs:30_000});
});

test('codex profile checks CLI and fails with bounded dependency diagnostic', async () => {
  const client = fakeClient(64, 'MISSING:codex\n');
  await assert.rejects(assertAgentRuntimeReady(client, 'sbx_test', 'codex'), /missing codex/);
  assert.match(client.calls[0][2][1], /command -v codex/);
});

test('reject unexpected or spoofed marker on a failed command', async () => {
  const client = fakeClient(1, 'paperclip-space-runtime-ready:codex');
  await assert.rejects(assertAgentRuntimeReady(client, 'sbx_test', 'codex'), /check failed \\(exit 1\\)/);
});

test('reject a false success that lacks the expected marker', async () => {
  const client = fakeClient(0, 'some unrelated output');
  await assert.rejects(assertAgentRuntimeReady(client, 'sbx_test', 'node-tooling'), /check failed \\(exit 0\\)/);
});

test('reject invalid runtime profiles before starting any command', async () => {
  const client = fakeClient(0, '');
  await assert.rejects(assertAgentRuntimeReady(client, 'sbx_test', 'arbitrary-command'), /Invalid SPACE agent runtime profile/);
  assert.deepEqual(client.calls, []);
  assert.deepEqual(RUNTIME_PROFILES, ['none','node-tooling','codex']);
});
