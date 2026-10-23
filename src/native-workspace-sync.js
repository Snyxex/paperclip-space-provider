/**
 * Native SPACE files:read/write/list/mkdir/rename transport (incubating API).
 * Explicit opt-in and fail-closed: no fallback to command-embedded data.
 * File/dir mappings are bounded; symlinks and hardlinks are rejected.
 * The endpoint's incubating status and path TOCTOU risks require disposable
 * integration testing before use with real repositories.
 */
import os from 'node:os';
import path from 'node:path';
import {constants as F, promises as fs} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {identifier, WORKSPACE} from './config.js';

const CHUNK = 512 * 1024;
export const LIMITS = Object.freeze({fileBytes:16*1024*1024, totalBytes:64*1024*1024, files:512, depth:24});

function guestPath(p, rootAllowed = false) {
  if (typeof p !== 'string' || !path.posix.isAbsolute(p) ||
      p.includes('\0') || p.includes('\\') || p.split('/').includes('..')) {
    throw new Error('Unsafe SPACE guest path');
  }
  const fixed = path.posix.normalize(p);
  if (fixed !== WORKSPACE && !fixed.startsWith(WORKSPACE+'/')) throw new Error('Guest path outside workspace');
  if (fixed === WORKSPACE && !rootAllowed) throw new Error('Guest file may not be the workspace root');
  return fixed;
}

function localPath(root, candidate, rootAllowed = false) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof candidate !== 'string' ||
      !path.isAbsolute(candidate) || candidate.includes('\0') ||
      candidate.split(path.sep).includes('..')) throw new Error('Invalid host workspace path');
  const fixed = path.resolve(candidate);
  const base = path.resolve(root);
  if (fixed !== base && !fixed.startsWith(base+path.sep)) throw new Error('Host path outside workspace');
  if (fixed === base && !rootAllowed) throw new Error('Mapping may not overwrite host workspace root');
  return fixed;
}

async function hostGuard(root, filename, kind = 'any', missing = false) {
  const base = path.resolve(root), file = localPath(base, filename, true);
  const real = await fs.realpath(base);
  if (real !== base || !(await fs.lstat(base)).isDirectory()) throw new Error('Workspace root must be a real directory');
  let current = base;
  for (const part of path.relative(base,file).split(path.sep).filter(Boolean)) {
    current = path.join(current,part);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (err) { if (missing && err.code === 'ENOENT') continue; throw err; }
    if (stat.isSymbolicLink()) throw new Error('Host symlinks are forbidden in workspace sync');
    if (current !== file && !stat.isDirectory()) throw new Error('Host parent is not a directory');
    if (current === file) {
      if (kind === 'file' && !stat.isFile()) throw new Error('Expected a regular local file');
      if (kind === 'directory' && !stat.isDirectory()) throw new Error('Expected a local directory');
      if (stat.isFile() && stat.nlink !== 1) throw new Error('Host hardlinks are forbidden');
    }
  }
  return file;
}

function checkCount(count, bytes) {
  if (count > LIMITS.files) throw new Error('Workspace sync file-count limit exceeded');
  if (bytes > LIMITS.totalBytes) throw new Error('Workspace sync total-byte limit exceeded');
}

function exclude(relative, patterns) {
  return patterns.some(p => path.matchesGlob(relative,p) ||
    path.matchesGlob(relative,p+'/**') || path.matchesGlob(relative,'**/'+p) ||
    path.matchesGlob(relative,'**/'+p+'/**'));
}

function patternsFor(mapping) {
  if (mapping.followSymlinks === true) throw new Error('Following symlinks is forbidden');
  if (mapping.mode != null && (!Number.isInteger(mapping.mode) || mapping.mode < 0 || mapping.mode > 0o777)) {
    throw new Error('Invalid file mode');
  }
  const patterns = mapping.exclude ?? [];
  if (!Array.isArray(patterns) || patterns.some(p => typeof p !== 'string' || !p ||
    p.includes('\0') || p.includes('\\') || p.startsWith('/') || p.split('/').includes('..'))) {
    throw new Error('Invalid directory exclude pattern');
  }
  return patterns;
}
function apiPath(id, action) { return '/v1/sandboxes/'+id+'/files:'+action; }
function requireOk(data, operation) { if (data?.ok !== true) throw new Error('SPACE '+operation+' did not confirm success'); }
function entryKind(entry, expected, label) {
  if (!entry || entry.file_type !== expected || typeof entry.path !== 'string') {
    throw new Error('SPACE '+label+' returned an unexpected file type');
  }
  if (expected === 'file' &&
      (entry.link_count !== 1 || !Number.isSafeInteger(entry.size_bytes) ||
       entry.size_bytes < 0 || entry.size_bytes > LIMITS.fileBytes)) {
    throw new Error('SPACE file is oversized or has unknown/multiple hardlinks');
  }
}

async function statGuest(client, id, p) {
  try {
    const response = await client.api(apiPath(id,'stat'),{method:'POST',body:{path:p}});
    if (!response?.entry || response.entry.path !== p) throw new Error('Invalid SPACE file stat response');
    return response.entry;
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function ensureGuestDirectories(client,id,directory, create) {
  const dir = guestPath(directory,true);
  let segment = '';
  for (const part of dir.split('/').filter(Boolean)) {
    segment += '/'+part;
    if (!segment.startsWith(WORKSPACE)) continue;
    let st = await statGuest(client,id,segment);
    if (st === null && create) {
      requireOk(await client.api(apiPath(id,'mkdir'),{
        method:'POST',key:randomUUID(),body:{path:segment,parents:false}
      }),'directory creation');
      st = await statGuest(client,id,segment);
    }
    if (!st) throw new Error('Missing SPACE workspace directory');
    entryKind(st,'directory','parent');
  }
}

async function readHost(host) {
  const fd = await fs.open(host,F.O_RDONLY | F.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > LIMITS.fileBytes) {
      throw new Error('Host source is not a bounded, unlinked regular file');
    }
    return {fd, stat};
  } catch (err) { await fd.close(); throw err; }
}

async function nativeWrite(client,id,item) {
  await ensureGuestDirectories(client,id,path.posix.dirname(item.remote),true);
  const stage = path.posix.dirname(item.remote)+'/.paperclip-space-upload-'+randomUUID();
  const source = await readHost(item.host);
  let written = 0, created = false;
  try {
    const current = await statGuest(client,id,item.remote);
    if (current && current.file_type !== 'file') throw new Error('Refusing to overwrite nonregular guest path');
    if (current && current.link_count !== 1) throw new Error('Refusing to overwrite hardlinked guest file');
    do {
      const size = Math.min(CHUNK, source.stat.size-written);
      const chunk = Buffer.alloc(size);
      const {bytesRead} = await source.fd.read(chunk,0,size,written);
      if (bytesRead !== size) throw new Error('Host source changed during upload');
      const response = await client.api(apiPath(id,'write'),{
        method:'POST', key:randomUUID(), body:{
          path:stage, data_base64:chunk.toString('base64'),
          append:written>0, parents:false
        }
      });
      if (response?.bytes_written !== size) throw new Error('SPACE native write length mismatch');
      created = true;
      written += size;
    } while (written < source.stat.size || !created);
    const stageStat = await statGuest(client,id,stage);
    entryKind(stageStat,'file','staged upload');
    if (stageStat.size_bytes !== written) throw new Error('SPACE staged upload size mismatch');
    const currentAgain = await statGuest(client,id,item.remote);
    if (currentAgain && (currentAgain.file_type !== 'file' || currentAgain.link_count !== 1)) {
      throw new Error('Unsafe destination changed during upload');
    }
    requireOk(await client.api(apiPath(id,'rename'),{
      method:'POST',key:randomUUID(),body:{old_path:stage,new_path:item.remote}
    }),'atomic upload rename');
    created = false;
    if (item.mode != null) {
      const result = await client.exec(id,'chmod',[item.mode.toString(8), item.remote]);
      if (result?.exitCode !== 0) throw new Error('Guest chmod failed');
    }
    return written;
  } finally {
    await source.fd.close();
    if (created) await client.api(apiPath(id,'remove'),{
      method:'POST',key:randomUUID(),body:{path:stage,recursive:false}
    }).catch(()=>{});
  }
}

async function nativeRead(client,id,item,root) {
  await ensureGuestDirectories(client,id,path.posix.dirname(item.remote),false);
  const st = await statGuest(client,id,item.remote);
  entryKind(st,'file','read source');
  if (st.size_bytes !== item.size) throw new Error('Guest file changed before download');
  await hostGuard(root,item.host,'any',true);
  const parent = path.dirname(item.host);
  await fs.mkdir(parent,{recursive:true,mode:0o700});
  await hostGuard(root,parent,'directory');
  const temp = path.join(parent,'.paperclip-space-download-'+randomUUID());
  const handle = await fs.open(temp,F.O_CREAT|F.O_EXCL|F.O_WRONLY|F.O_NOFOLLOW,item.mode??0o600);
  let transferred = 0;
  try {
    while (transferred < st.size_bytes) {
      const length = Math.min(CHUNK,st.size_bytes-transferred);
      const data = await client.readFile(id,item.remote,transferred,length);
      if (!Buffer.isBuffer(data) || data.length !== length) throw new Error('SPACE native read was incomplete');
      await handle.writeFile(data);
      transferred += length;
    }
    await handle.sync();
    await handle.close();
    const after = await statGuest(client,id,item.remote);
    entryKind(after,'file','read source after transfer');
    if (after.size_bytes !== st.size_bytes) throw new Error('Guest file changed during download');
    await hostGuard(root,item.host,'any',true);
    await fs.rename(temp,item.host);
    if (item.mode != null) await fs.chmod(item.host,item.mode);
    return transferred;
  } catch (err) {
    await handle.close().catch(()=>{});
    throw err;
  } finally { await fs.rm(temp,{force:true}).catch(()=>{}); }
}

async function expandLocal(root, source, destination, patterns, push, depth = 0) {
  if (depth > LIMITS.depth) throw new Error('Workspace directory depth limit exceeded');
  const entries = await fs.readdir(source,{withFileTypes:true});
  for (const entry of entries) {
    const host = path.join(source,entry.name);
    const relative = path.relative(root,host).split(path.sep).join('/');
    if (exclude(relative,patterns) || exclude(entry.name,patterns)) continue;
    if (entry.isSymbolicLink()) throw new Error('Directory contains a symlink');
    if (entry.isDirectory()) {
      await hostGuard(root,host,'directory');
      const target = guestPath(path.posix.join(destination,entry.name),true);
      push({kind:'directory',remote:target,host});
      await expandLocal(root,host,target,patterns,push,depth+1);
    } else if (entry.isFile()) {
      const safe = await hostGuard(root,host,'file');
      const st=await fs.lstat(safe);
      if (st.size>LIMITS.fileBytes || st.nlink!==1) throw new Error('Invalid file in local directory');
      push({kind:'file',host:safe,remote:guestPath(path.posix.join(destination,entry.name)),size:st.size});
    } else throw new Error('Directory contains unsupported filesystem entries');
  }
}

async function expandGuest(client,id,source,destination,patterns,push,depth=0) {
  if (depth > LIMITS.depth) throw new Error('SPACE directory depth limit exceeded');
  await ensureGuestDirectories(client,id,source,false);
  const result = await client.api(apiPath(id,'list'),{method:'POST',body:{path:source,depth:1}});
  if (!Array.isArray(result?.entries) || result.entries.length>LIMITS.files) throw new Error('Invalid SPACE directory listing');
  const seen = new Set();
  for (const entry of result.entries) {
    const guest = guestPath(entry.path);
    if (path.posix.dirname(guest) !== source || seen.has(guest)) throw new Error('Unsafe SPACE directory listing');
    seen.add(guest);
    const relative = path.posix.relative(source,guest), dest=path.join(destination,relative);
    if (exclude(relative,patterns) || exclude(path.posix.basename(guest),patterns)) continue;
    if (entry.file_type==='directory') {
      push({kind:'directory',host:dest,remote:guest});
      await expandGuest(client,id,guest,dest,patterns,push,depth+1);
    } else {
      entryKind(entry,'file','directory listing');
      push({kind:'file',host:dest,remote:guest,size:entry.size_bytes});
    }
  }
}

export async function syncNativeFiles(client,params,direction) {
  if (params.config?.transferMode !== 'native-incubating') throw new Error('SPACE native file transfer requires explicit opt-in');
  if (!['in','out'].includes(direction)) throw new Error('Invalid native sync direction');
  const id=identifier(params.lease?.providerLeaseId,'sbx_');
  const root=params.workspace?.localPath;
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Trusted Paperclip workspace root is required');
  await hostGuard(root,root,'directory');
  if (!Array.isArray(params.operations)) throw new Error('Missing Paperclip sync operations');
  const plans=[];
  let count=0,total=0;
  const push=(items,item)=>{
    if (item.kind==='file') {
      count++; total+=item.size;
      if (item.size>LIMITS.fileBytes) throw new Error('Workspace file size limit exceeded');
    }
    checkCount(count,total);
    items.push(item);
  };
  for(const operation of params.operations) {
    if(typeof operation?.operationId !== 'string'||!Array.isArray(operation.files)) throw new Error('Invalid sync operation');
    if(operation.postUploadCommands?.length) throw new Error('Post-upload commands require reviewed integration support');
    const items=[];
    for(const mapping of operation.files) {
      if(!['file','directory'].includes(mapping?.kind)) throw new Error('Unsupported mapping kind');
      const patterns=patternsFor(mapping);
      const source=direction==='in'?mapping.sourcePath:mapping.targetPath;
      const destination=direction==='in'?mapping.targetPath:mapping.sourcePath;
      const host=localPath(root,source,mapping.kind==='directory');
      const remote=guestPath(destination,mapping.kind==='directory');
      if(direction==='in') {
        if(mapping.kind==='file'){
          await hostGuard(root,host,'file');
          const st=await fs.lstat(host);
          push(items,{kind:'file',host,remote,size:st.size,mode:mapping.mode});
        } else {
          await hostGuard(root,host,'directory');
          push(items,{kind:'directory',host,remote});
          await expandLocal(root,host,remote,patterns,item=>push(items,item));
        }
      } else {
        await hostGuard(root,host,'any',true);
        if(mapping.kind==='file'){
          await ensureGuestDirectories(client,id,path.posix.dirname(remote),false);
          const st=await statGuest(client,id,remote);
          entryKind(st,'file','mapping source');
          push(items,{kind:'file',host,remote,size:st.size_bytes,mode:mapping.mode});
        } else {
          push(items,{kind:'directory',host,remote});
          await expandGuest(client,id,remote,host,patterns,item=>push(items,item));
        }
      }
    }
    plans.push({operationId:operation.operationId,items});
  }
  const operations=[];
  for(const plan of plans){
    let bytesTransferred=0,filesTransferred=0;
    for(const item of plan.items){
      if(item.kind==='directory'){
        if(direction==='in') await ensureGuestDirectories(client,id,item.remote,true);
        else {
          await hostGuard(root,item.host,'any',true);
          await fs.mkdir(item.host,{recursive:true,mode:0o700});
          await hostGuard(root,item.host,'directory');
        }
      } else {
        bytesTransferred+=direction==='in'?
          await nativeWrite(client,id,item):
          await nativeRead(client,id,item,root);
        filesTransferred++;
      }
    }
    operations.push({operationId:plan.operationId,filesTransferred,bytesTransferred});
  }
  return {operations};
}
