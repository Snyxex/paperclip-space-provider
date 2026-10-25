import {randomUUID} from 'node:crypto';
import {identifier, WORKSPACE} from './config.js';

// Disposable, credential-free fixture. Never take user-supplied code or paths here.
const SOURCE = Buffer.from([
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "test('paperclip-space-fixture', () => { assert.equal(6 * 7, 42); });",
  '',
].join('\n'), 'utf8');

export async function runSyntheticNodeTest(client, sandboxId) {
  const id = identifier(sandboxId, 'sbx_');
  const guestPath = `${WORKSPACE}/paperclip-space-fixture.test.mjs`;
  const written = await client.api(`/v1/sandboxes/${id}/files:write`, {
    method: 'POST', key: randomUUID(),
    body: {path: guestPath, data_base64: SOURCE.toString('base64'), append: false, parents: false},
  });
  if (written.bytes_written !== SOURCE.length) throw new Error('SPACE synthetic test upload was incomplete');

  const copied = await client.readFile(id, guestPath, 0, SOURCE.length);
  if (!Buffer.isBuffer(copied) || !copied.equals(SOURCE)) {
    throw new Error('SPACE synthetic test file round-trip failed');
  }

  const result = await client.exec(id, 'node', ['--test', guestPath], {
    cwd: WORKSPACE,
    timeoutMs: Math.min(90_000, client.config.timeoutMs),
  });
  if (result.exitCode !== 0 || !result.stdout?.includes('paperclip-space-fixture') ||
    !/^# pass 1$/m.test(result.stdout)) {
    throw new Error('SPACE synthetic Node test failed');
  }
  return {fileBytes: SOURCE.length, testsPassed: 1};
}
