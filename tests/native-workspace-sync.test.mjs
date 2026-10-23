import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {mkdtemp,writeFile,readFile,mkdir,readdir,rm,symlink,stat} from 'node:fs/promises';
import {syncNativeFiles,LIMITS} from '../src/native-workspace-sync.js';

const ROOT='/paperclip-workspace';
const create=async()=>mkdtemp(path.join(tmpdir(),'paperclip-space-native-'));
const m=(sourcePath,targetPath,kind='file',extra={})=>({sourcePath,targetPath,kind,...extra});
const params=(root,mappings,mode='native-incubating')=>({
  config:{transferMode:mode}, workspace:{localPath:root},
  lease:{providerLeaseId:'sbx_test'},operations:[{operationId:'op_1',files:mappings}]
});
const entry=(p,buffer=null,kind='file')=>({
 path:p,name:path.posix.basename(p),file_type:kind,
 size_bytes:buffer?.length??0, mode:384,link_count:kind==='file'?1:2
});
function fakeSpace() {
 const dirs=new Set([ROOT]),files=new Map(),calls=[];
 let forcePartialRead=false;
 const client={
   dirs,files,calls,
   get partial(){return forcePartialRead}, set partial(x){forcePartialRead=x},
   async api(url,{body}={}) {
     const action=url.split('files:')[1];
     calls.push([action,structuredClone(body)]);
     if(action==='stat'){
       if(dirs.has(body.path)) return {entry:entry(body.path,null,'directory')};
       if(files.has(body.path)) return {entry:entry(body.path,files.get(body.path))};
       const err=new Error('Not found');err.status=404;throw err;
     }
     if(action==='mkdir'){
       if(!dirs.has(path.posix.dirname(body.path)))throw new Error('Missing parent directory');
       dirs.add(body.path);return {ok:true};
     }
     if(action==='write'){
       const chunk=Buffer.from(body.data_base64,'base64');
       if(!dirs.has(path.posix.dirname(body.path)))throw new Error('Missing parent directory');
       files.set(body.path,body.append?Buffer.concat([files.get(body.path)??Buffer.alloc(0),chunk]):chunk);
       return {bytes_written:chunk.length};
     }
     if(action==='rename'){
       if(!files.has(body.old_path))throw new Error('No staging file');
       files.set(body.new_path,files.get(body.old_path));files.delete(body.old_path);
       return {ok:true};
     }
     if(action==='remove'){files.delete(body.path);return {ok:true};}
     if(action==='list'){
       const children=[...dirs].filter(x=>path.posix.dirname(x)===body.path).map(x=>entry(x,null,'directory'));
       for(const [p,buf] of files)if(path.posix.dirname(p)===body.path)children.push(entry(p,buf));
       return {entries:children};
     }
     throw new Error('Unsupported action '+action);
   },
   async readFile(_id,p,offset,length) {
     calls.push(['read', {p,offset,length}]);
     const chunk=files.get(p)?.subarray(offset,offset+length);
     if(!chunk)throw new Error('File not found');
     return forcePartialRead?chunk.subarray(0,chunk.length-1):chunk;
   },
   async exec(_id,command,args) {
     assert.equal(command,'chmod');
     calls.push(['chmod',{args}]);return {exitCode:0};
   }
 };
 return client;
}

test('native transport disabled without opt-in',async()=>{
 const root=await create();try{
   const f=path.join(root,'a');await writeFile(f,'a');
   const client=fakeSpace();
   await assert.rejects(syncNativeFiles(client,params(root,[m(f,ROOT+'/a')],'disabled'),'in'),/opt-in/);
   assert.equal(client.calls.length,0);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('binary native upload uses file API and atomic rename, never command data',async()=>{
 const root=await create();try{
   const f=path.join(root,'binary'),data=Buffer.alloc(650_000);
   for(let i=0;i<data.length;i++)data[i]=i%251;
   await writeFile(f,data);
   const client=fakeSpace();
   const result=await syncNativeFiles(client,params(root,[m(f,ROOT+'/binary')]),'in');
   assert.deepEqual(client.files.get(ROOT+'/binary'),data);
   assert.equal(result.operations[0].bytesTransferred,data.length);
   assert.equal(result.operations[0].filesTransferred,1);
   assert.equal(client.calls.filter(([a])=>a==='write').length,2);
   assert.equal(client.calls.filter(([a])=>a==='rename').length,1);
   assert.equal(client.calls.filter(([a])=>a==='chmod').length,0);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('recursive upload with exclusions and nested directories',async()=>{
 const root=await create();try{
   const folder=path.join(root,'repo');
   await mkdir(path.join(folder,'src'),{recursive:true});
   await mkdir(path.join(folder,'node_modules'),{recursive:true});
   await writeFile(path.join(folder,'src','index.js'),'export const n=1;');
   await writeFile(path.join(folder,'node_modules','pkg'),'exclude me');
   const client=fakeSpace();
   const out=await syncNativeFiles(client,params(root,[m(folder,ROOT+'/repo','directory',{exclude:['node_modules']})]),'in');
   assert.equal(client.files.get(ROOT+'/repo/src/index.js').toString(),'export const n=1;');
   assert.ok(client.dirs.has(ROOT+'/repo/src'));
   assert.ok(!client.files.has(ROOT+'/repo/node_modules/pkg'));
   assert.equal(out.operations[0].filesTransferred,1);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('native download has complete bounded binary content',async()=>{
 const root=await create();try{
   const client=fakeSpace(),dst=path.join(root,'output.bin'),buf=Buffer.from([0,255,42,10]);
   client.files.set(ROOT+'/out',buf);
   const out=await syncNativeFiles(client,params(root,[m(ROOT+'/out',dst)]),'out');
   assert.deepEqual(await readFile(dst),buf);
   assert.equal(out.operations[0].bytesTransferred,4);
   assert.equal(client.calls.filter(([a])=>a==='read').length,1);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('recursive native download creates nested files and excludes folders',async()=>{
 const root=await create();try{
   const client=fakeSpace(),dst=path.join(root,'exports');
   client.dirs.add(ROOT+'/repo');client.dirs.add(ROOT+'/repo/docs');client.dirs.add(ROOT+'/repo/.git');
   client.files.set(ROOT+'/repo/docs/readme.md',Buffer.from('hello'));
   client.files.set(ROOT+'/repo/.git/config',Buffer.from('private'));
   const out=await syncNativeFiles(client,params(root,[m(ROOT+'/repo',dst,'directory',{exclude:['.git']})]),'out');
   assert.equal(await readFile(path.join(dst,'docs','readme.md'),'utf8'),'hello');
   await assert.rejects(readFile(path.join(dst,'.git','config')),{code:'ENOENT'});
   assert.equal(out.operations[0].filesTransferred,1);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('refuse host traversal and symlinks without guest effects',async()=>{
 const root=await create(),outside=await create();
 try{
   const safe=path.join(root,'safe'),bad=path.join(root,'alias');
   await writeFile(safe,'x');await symlink(safe,bad);
   const client=fakeSpace();
   await assert.rejects(syncNativeFiles(client,params(root,[m(bad,ROOT+'/alias')]),'in'),/symlink/i);
   await assert.rejects(syncNativeFiles(client,params(root,[m(path.join(outside,'file'),ROOT+'/outside')]),'in'),/outside workspace/);
   await assert.rejects(syncNativeFiles(client,params(root,[m(safe,ROOT+'/../etc/passwd')]),'in'),/Unsafe SPACE guest path/);
   assert.equal(client.calls.length,0);
 }finally{await Promise.all([rm(root,{recursive:true,force:true}),rm(outside,{recursive:true,force:true})])}
});

test('reject files larger than native limit before mutation',async()=>{
 const root=await create();try{
   const f=path.join(root,'huge');await writeFile(f,Buffer.alloc(LIMITS.fileBytes+1));
   const client=fakeSpace();
   await assert.rejects(syncNativeFiles(client,params(root,[m(f,ROOT+'/huge')]),'in'),/size limit/);
   assert.equal(client.calls.length,0);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('reject guest hardlinks before reading local files',async()=>{
 const root=await create();try{
   const client=fakeSpace();client.files.set(ROOT+'/linked',Buffer.from('secret'));
   const original=client.api.bind(client);
   client.api=async(url,options)=>{
     const response=await original(url,options);
     if(url.endsWith('files:stat')&&options.body.path===ROOT+'/linked')response.entry.link_count=2;
     return response;
   };
   await assert.rejects(syncNativeFiles(client,params(root,[m(ROOT+'/linked',path.join(root,'out'))]),'out'),/hardlinks/);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('incomplete native download does not overwrite destination',async()=>{
 const root=await create();try{
   const client=fakeSpace(),target=path.join(root,'destination');
   client.files.set(ROOT+'/result',Buffer.from('abcdef'));client.partial=true;
   await writeFile(target,'preserve');
   await assert.rejects(syncNativeFiles(client,params(root,[m(ROOT+'/result',target)]),'out'),/incomplete/);
   assert.equal(await readFile(target,'utf8'),'preserve');
   assert.deepEqual((await readdir(root)).sort(),['destination']);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('native transfer rejects post-upload commands before mutations',async()=>{
 const root=await create();try{
   const client=fakeSpace(),p=params(root,[]);
   p.operations[0].postUploadCommands=[{command:'echo hello'}];
   await assert.rejects(syncNativeFiles(client,p,'in'),/Post-upload/);
   assert.equal(client.calls.length,0);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('reject guest listing with unexpected absolute path',async()=>{
 const root=await create();try{
   const client=fakeSpace();client.dirs.add(ROOT+'/repo');
   const original=client.api.bind(client);
   client.api=async(url,options)=>{
     if(url.endsWith('files:list'))return {entries:[entry('/etc/shadow',Buffer.from('x'))]};
     return original(url,options);
   };
   await assert.rejects(syncNativeFiles(client,params(root,[m(ROOT+'/repo',path.join(root,'export'),'directory')]),'out'),/outside workspace/);
 }finally{await rm(root,{recursive:true,force:true})}
});
