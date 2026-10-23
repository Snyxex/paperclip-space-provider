import test from 'node:test';
import assert from 'node:assert/strict';
import {run} from '../examples/native-sync-integration.mjs';

test('VM integration test requires an explicit, exact confirmation',async()=>{
  let created=0;
  class MockClient {constructor(){created++}}
  const injection={SpaceClientClass:MockClient,sync:()=>{throw new Error('not reached')}};
  for (const env of [
    {},
    {SPACE_INTEGRATION_CONFIRM:'yes'},
    {SPACE_INTEGRATION_CONFIRM:'DISPOSABLE_VM_ONLY '}]) {
    await assert.rejects(run(env,injection),/Refusing to create VM/);
  }
  assert.equal(created,0);
});

test('VM integration test refuses Jenkins by default',async()=>{
  let created=0;
  class MockClient {constructor(){created++}}
  const env={
    SPACE_INTEGRATION_CONFIRM:'DISPOSABLE_VM_ONLY',
    SPACE_API_URL:'https://api.test.invalid',
    SPACE_DATA_PLANE_URL:'https://data.test.invalid',
    SPACE_API_TOKEN:'dummy',
    CI:'true'
  };
  await assert.rejects(run(env,{SpaceClientClass:MockClient}),/Refusing an automatic Jenkins/);
  assert.equal(created,0);
});

test('VM integration test rejects missing credentials before constructing a client',async()=>{
  let created=0;
  class MockClient {constructor(){created++}}
  const env={SPACE_INTEGRATION_CONFIRM:'DISPOSABLE_VM_ONLY'};
  await assert.rejects(run(env,{SpaceClientClass:MockClient}),/SPACE_API_URL must be set/);
  assert.equal(created,0);
});
