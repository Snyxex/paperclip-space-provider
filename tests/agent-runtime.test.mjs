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
  await assert.rejects(assertAgentRuntimeReady(client, 'sbx_test', 'codex'), /check failed \(exit 1\)/);
});

test('reject a false success that lacks the expected marker', async () => {
  const client = fakeClient(0, 'some unrelated output');
  await assert.rejects(assertAgentRuntimeReady(client, 'sbx_test', 'node-tooling'), /check failed \(exit 0\)/);
});

test('reject invalid runtime profiles before starting any command', async () => {
  const client = fakeClient(0, '');
  await assert.rejects(assertAgentRuntimeReady(client, 'sbx_test', 'arbitrary-command'), /Invalid SPACE agent runtime profile/);
  assert.deepEqual(client.calls, []);
  assert.deepEqual(RUNTIME_PROFILES, ['none','node-tooling','codex']);
});

import {parseConfig} from '../src/config.js';

test('runtime and file smoke choices are strict and opt-in', () => {
  const base = {
    apiUrl:'http://172.20.0.1:18080',
    dataPlaneUrl:'http://172.20.0.1:18090',
    allowInsecurePrivateHttp:true,
    apiToken:'unit-test-only',
  };
  const defaults = parseConfig(base);
  assert.equal(defaults.runtimeProfile, 'none');
  assert.equal(defaults.probeScenario, 'command');

  const node = parseConfig({...base, runtimeProfile:'node-tooling', transferMode:'native-incubating', probeScenario:'node-file-test'});
  assert.equal(node.runtimeProfile, 'node-tooling');
  assert.equal(node.probeScenario, 'node-file-test');
  assert.throws(() => parseConfig({...base, runtimeProfile:'unknown'}), /Invalid runtimeProfile/);
  assert.throws(() => parseConfig({...base, probeScenario:'unsafe'}), /Invalid probeScenario/);
  assert.throws(() => parseConfig({...base, probeScenario:'node-file-test', runtimeProfile:'node-tooling'}), /requires transferMode native-incubating/);
  assert.throws(() => parseConfig({...base, probeScenario:'node-file-test', transferMode:'native-incubating'}), /requires transferMode native-incubating/);
});
