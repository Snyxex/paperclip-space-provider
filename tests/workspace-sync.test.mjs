import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, mkdir, rm, symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {syncFiles, assertRemoteFile, assertHostFile, MAX_FILE_BYTES, MAX_SYNC_FILES} from '../src/workspace-sync.js';

const sandbox = 'sbx_test';
const mk=async()=>mkdtemp(path.join(os.tmpdir(),'space-sync-test-'));
const params=(root,files,transferMode='command-experimental')=>({config:{transferMode},workspace:{localPath:root},lease:{providerLeaseId:sandbox},operations:[{operationId:'op_test',files}]});
const file=(sourcePath,targetPath,kind='file')=>({kind,sourcePath,targetPath});

for (const bad of ['/paperclip-workspace','/paperclip-workspace/../etc/passwd','/etc/passwd','paperclip-workspace/a','/paperclip-workspace/a/../../b','/paperclip-workspace/a\\b','/paperclip-workspace/f\0']) {
  test('reject unsafe remote path '+JSON.stringify(bad),()=>assert.throws(()=>assertRemoteFile(bad)));
}
test('legitimate remote nested path allowed',()=>assert.equal(assertRemoteFile('/paperclip-workspace/docs/test.md'),'/paperclip-workspace/docs/test.md'));
test('disabled by default: no guest command',async()=>{
 const root=await mk();try{
   const src=path.join(root,'a');await writeFile(src,'a');let called=0;
   await assert.rejects(syncFiles({exec(){called++}},params(root,[file(src,'/paperclip-workspace/a')],'disabled'),'in'),/disabled/);
   assert.equal(called,0);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('host path must stay within approved workspace',async()=>{
 const root=await mk(), outside=await mk();try{
  const x=path.join(outside,'other');await writeFile(x,'secret');
  await assert.rejects(assertHostFile(x,root,'in'),/escapes/);
  await assert.rejects(assertHostFile(root+'/../escape',root,'out'),/clean/);
 }finally{await Promise.all([rm(root,{recursive:true,force:true}),rm(outside,{recursive:true,force:true})])}
});
test('reject symlink source and symlink parent',async()=>{
 const root=await mk();try{
  await writeFile(path.join(root,'legit'),'a');
  await symlink(path.join(root,'legit'),path.join(root,'link'));
  await assert.rejects(assertHostFile(path.join(root,'link'),root,'in'),/regular/);
  await symlink(root,path.join(root,'linkdir'));
  await assert.rejects(assertHostFile(path.join(root,'linkdir','legit'),root,'in'),/symlink/);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('reject directory mappings and post-upload commands BEFORE any guest command',async()=>{
 const root=await mk();try{
   let calls=0;const mock={exec(){calls++}};
   await assert.rejects(syncFiles(mock,params(root,[file(root,'/paperclip-workspace/tree','directory')]),'in'),/Only regular/);
   const p=params(root,[]);p.operations[0].postUploadCommands=[{command:'echo hi'}];
   await assert.rejects(syncFiles(mock,p,'in'),/Post-upload commands/);
   assert.equal(calls,0);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('regular guest upload with bounded base64 and staging cleanup',async()=>{
 const root=await mk();try{
  const src=path.join(root,"a'quote.txt");await writeFile(src,Buffer.from([0,1,2,255]));
  const seen=[];const mock={async exec(_id,cmd,args){seen.push({cmd,args});return {exitCode:0,stdout:args[1].includes('mktemp -d')?'/paperclip-workspace/.paperclip-space-sync-ABCDEFGH\n':''}}};
  const r=await syncFiles(mock,params(root,[file(src,'/paperclip-workspace/a.txt')]),'in');
  assert.deepEqual(r.operations,[{operationId:'op_test',filesTransferred:1,bytesTransferred:4}]);
  assert.ok(seen.some(x=>x.args[1].includes('AAEC/w==')));
  assert.ok(seen.at(-1).args[1].includes('rm -rf'));
  assert.ok(seen.every(x=>x.cmd==='sh'));
 }finally{await rm(root,{recursive:true,force:true})}
});
test('guest download atomically creates host file from base64',async()=>{
 const root=await mk();try{
   const dst=path.join(root,'export.txt'), calls=[];
   const mock={async exec(_id,_cmd,args){calls.push(args[1]);return {exitCode:0,stdout:args[1].includes('wc -c <')?'5\n':Buffer.from('hello').toString('base64')}}};
   const result=await syncFiles(mock,params(root,[file('/paperclip-workspace/out.txt',dst)]),'out');
   assert.equal((await readFile(dst)).toString(),'hello');
   assert.equal(result.operations[0].bytesTransferred,5);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('guest size mismatch fails without writing local file',async()=>{
 const root=await mk();try{
  const dst=path.join(root,'result');const mock={async exec(_id,_cmd,args){return {exitCode:0,stdout:args[1].includes('wc -c <')?'10\n':'aGVsbG8='}}};
  await assert.rejects(syncFiles(mock,params(root,[file('/paperclip-workspace/result',dst)]),'out'),/mismatch/);
  await assert.rejects(readFile(dst),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true})}
});
test('reject oversized inbound before any guest action',async()=>{
 const root=await mk();try{
  const src=path.join(root,'oversize');await writeFile(src,Buffer.alloc(MAX_FILE_BYTES+1));let calls=0;
  await assert.rejects(syncFiles({exec(){calls++}},params(root,[file(src,'/paperclip-workspace/oversize')]),'in'),/exceeds/);
  assert.equal(calls,0);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('reject over-limit mapping count before guest commands',async()=>{
 const root=await mk();try{
  let calls=0;await writeFile(path.join(root,'legit'),'a');const files=Array.from({length:MAX_SYNC_FILES+1},(_,i)=>file(path.join(root,'legit'),'/paperclip-workspace/'+i));
  await assert.rejects(syncFiles({exec(){calls++}},params(root,files),'in'),/Too many/);
  assert.equal(calls,0);
 }finally{await rm(root,{recursive:true,force:true})}
});
