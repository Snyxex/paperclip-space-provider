import test from 'node:test';
import assert from 'node:assert/strict';
import {SpaceClient} from '../src/space-client.js';

const raw = {apiUrl:'https://api.space.invalid',dataPlaneUrl:'https://data.space.invalid',apiToken:'dev-only-placeholder'};
const p='/paperclip-workspace/fixture';
const id='sbx_test';

test('native read uses authorized, scoped binary endpoint and exact chunk length',async()=>{
  const calls=[];
  const client=new SpaceClient(raw,async(url,request)=>{
    calls.push({url,request});
    return new Response(new Uint8Array([0,128,255]),{headers:{'content-type':'application/octet-stream'}});
  });
  const out=await client.readFile(id,p,0,3);
  assert.deepEqual(out,Buffer.from([0,128,255]));
  assert.equal(calls[0].url,'https://api.space.invalid/v1/sandboxes/sbx_test/files:read');
  assert.deepEqual(JSON.parse(calls[0].request.body),{path:p,offset:0,length:3});
  assert.equal(calls[0].request.headers.Authorization,'Bearer dev-only-placeholder');
  assert.equal(calls[0].request.redirect,'error');
});
test('native read refuses unexpected content-type',async()=>{
  const client=new SpaceClient(raw,async()=>new Response('html',{headers:{'content-type':'text/html'}}));
  await assert.rejects(client.readFile(id,p,0,3),/invalid response type/);
});
test('native read refuses truncated binary stream',async()=>{
  const client=new SpaceClient(raw,async()=>new Response(new Uint8Array([1,2]),{headers:{'content-type':'application/octet-stream'}}));
  await assert.rejects(client.readFile(id,p,0,3),/length mismatch/);
});
test('native read refuses oversized binary stream',async()=>{
  const client=new SpaceClient(raw,async()=>new Response(new Uint8Array([1,2,3,4]),{headers:{'content-type':'application/octet-stream'}}));
  await assert.rejects(client.readFile(id,p,0,3),/incomplete or oversized/);
});
test('native read rejects traversal and out-of-range before network',async()=>{
  let calls=0;
  const client=new SpaceClient(raw,async()=>{calls++;throw new Error('Should not call')});
  for(const name of ['/paperclip-workspace/../etc/passwd','/etc/shadow']) {
    await assert.rejects(client.readFile(id,name,0,1),/Invalid SPACE native file read/);
  }
  await assert.rejects(client.readFile(id,p,0,1024*1024),/Invalid SPACE native file read/);
  assert.equal(calls,0);
});
test('native read turns failed HTTP status into bounded error',async()=>{
  const client=new SpaceClient(raw,async()=>new Response('unauthorized',{status:403}));
  await assert.rejects(client.readFile(id,p,0,3),/HTTP 403/);
});
