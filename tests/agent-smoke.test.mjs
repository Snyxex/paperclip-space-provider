import test from 'node:test';
import assert from 'node:assert/strict';
import {runSyntheticNodeTest} from '../src/agent-smoke.js';
const fake=(writeResult,readResult,execResult)=>{
  const calls=[];
  return {
    calls,
    config:{timeoutMs:300000},
    async api(path, options){calls.push({op:'api',path,options});return {bytes_written:writeResult ?? Buffer.from(options.body.data_base64,'base64').length};},
    async readFile(_id,path,_offset,_len){calls.push({op:'readFile',path});return readResult ?? Buffer.from(calls[0].options.body.data_base64,'base64');},
    async exec(_id,cmd,args,opts){calls.push({op:'exec',cmd,args,opts});return execResult ?? {exitCode:0,stdout:'ok 1 - paperclip-space-fixture\n# pass 1\n'};},
  }
}
test('synthetic test sends fixed bytes, reads them back, runs Node and checks TAP result',async()=>{
 const client=fake();const result=await runSyntheticNodeTest(client,'sbx_test');
 assert.equal(result.testsPassed,1);assert.ok(result.fileBytes>0);
 assert.equal(client.calls[0].options.method,'POST');
 assert.match(client.calls[0].path,/\/v1\/sandboxes\/sbx_test\/files:write$/);
 assert.ok(client.calls[0].options.key);
 assert.equal(client.calls[1].op,'readFile');
 assert.equal(client.calls[2].cmd,'node');
 assert.deepEqual(client.calls[2].args,['--test','/paperclip-workspace/paperclip-space-fixture.test.mjs']);
 assert.equal(client.calls[2].opts.timeoutMs,90000);
});
test('incomplete upload fails without guest command',async()=>{
 const client=fake(1);
 await assert.rejects(runSyntheticNodeTest(client,'sbx_test'),/upload was incomplete/);
 assert.equal(client.calls.length,1);
});
test('mismatched guest data fails without guest command',async()=>{
 const client=fake(undefined,Buffer.from('tampered'));
 await assert.rejects(runSyntheticNodeTest(client,'sbx_test'),/round-trip failed/);
 assert.equal(client.calls.length,2);
});
test('failed test result is not accepted',async()=>{
 const client=fake(undefined,undefined,{exitCode:1,stdout:'not ok 1 - paperclip-space-fixture\n# pass 0\n'});
 await assert.rejects(runSyntheticNodeTest(client,'sbx_test'),/Node test failed/);
});
test('invalid sandbox ID is rejected before any remote effects',async()=>{
 const client=fake();
 await assert.rejects(runSyntheticNodeTest(client,'../../etc'),/identifier/);
 assert.equal(client.calls.length,0);
});
