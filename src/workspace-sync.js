/**
 * Experimental bounded file sync for the supported SPACE command/SSE API.
 * Unlike a native file upload, data travels in command payloads and may be
 * retained by the SPACE control plane. Disabled unless explicitly opted in.
 */
import path from 'node:path';
import {constants as fsConstants, promises as fs} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {WORKSPACE, identifier, shellQuote} from './config.js';

export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_SYNC_BYTES = 4 * 1024 * 1024;
export const MAX_SYNC_FILES = 64;
const CHUNK_BYTES = 24 * 1024;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function assertRemoteFile(p) {
  if (typeof p !== 'string' || !path.posix.isAbsolute(p) || p.includes('\0') || p.includes('\\') || p.split('/').includes('..')) {
    throw new Error('Workspace sync requires a clean absolute guest path');
  }
  const result = path.posix.normalize(p);
  if (!result.startsWith(`${WORKSPACE}/`) || result.endsWith('/')) throw new Error('Guest file escapes sandbox workspace');
  return result;
}

/** Validate lexical scope and all existing components. Never traverse host links. */
export async function assertHostFile(p, root, direction) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Trusted local workspace root is required');
  if (typeof p !== 'string' || !path.isAbsolute(p) || p.includes('\0') || p.split(path.sep).includes('..')) {
    throw new Error('Workspace sync requires a clean absolute host path');
  }
  const full = path.resolve(p);
  const allowed = path.resolve(root);
  if (!full.startsWith(allowed + path.sep)) throw new Error('Host path escapes authorized workspace');
  const rel = path.relative(allowed, full);
  const segments = rel.split(path.sep);
  if (segments.some(x => !x || x === '.' || x === '..')) throw new Error('Invalid relative workspace path');
  let current = allowed;
  for (const segment of ['.', ...segments.slice(0, -1)]) {
    if (segment !== '.') current = path.join(current, segment);
    const st = await fs.lstat(current);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Host workspace contains a symlink or non-directory parent');
  }
  try {
    const st = await fs.lstat(full);
    if (st.isSymbolicLink() || !st.isFile()) throw new Error('Host workspace file is not regular');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (direction === 'in') throw new Error('Host source file does not exist');
  }
  return full;
}

function validateMapping(mapping, direction) {
  if (!mapping || mapping.kind !== 'file') throw new Error('Only regular file mappings are supported; directories are disabled');
  if (mapping.followSymlinks === true) throw new Error('Following workspace symlinks is forbidden');
  if (mapping.exclude?.length) throw new Error('File excludes are not supported in experimental sync');
  if (mapping.mode != null && (!Number.isInteger(mapping.mode) || mapping.mode < 0 || mapping.mode > 0o777)) throw new Error('Invalid file mode');
  return {
    host: direction === 'in' ? mapping.sourcePath : mapping.targetPath,
    remote: assertRemoteFile(direction === 'in' ? mapping.targetPath : mapping.sourcePath),
    mode: mapping.mode ?? 0o600,
  };
}

async function guestRun(client, id, script) {
  const output = await client.exec(id, 'sh', ['-c', `set -eu; ${script}`]);
  if (output?.timedOut || output?.exitCode !== 0) {
    // Never include guest stderr or command content; both may contain payloads.
    throw new Error('SPACE experimental workspace transfer command failed');
  }
  return output.stdout ?? '';
}

/** Fail closed against workspace escape caused by existing guest symlinks. */
function guestGuard(remote) {
  const q = shellQuote(remote);
  return `root=$(realpath -m -- ${shellQuote(WORKSPACE)}); test "$root" = ${shellQuote(WORKSPACE)}; ` +
    `resolved=$(realpath -m -- ${q}); case "$resolved" in "$root"/*) ;; *) exit 3;; esac; `;
}

async function readBoundedSource(file) {
  const f = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await f.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Host file exceeds experimental transfer limits');
    const bytes = await f.readFile();
    if (bytes.length > MAX_FILE_BYTES) throw new Error('Host file exceeded transfer limit while reading');
    return bytes;
  } finally {await f.close();}
}

async function syncInFile(client, id, host, remote, mode) {
  const bytes = await readBoundedSource(host);
  const stageRoot = await guestRun(client, id, `mktemp -d ${shellQuote(`${WORKSPACE}/.paperclip-space-sync-XXXXXXXX`)}`);
  const stage = stageRoot.trim();
  if (!/^\/paperclip-workspace\/\.paperclip-space-sync-[A-Za-z0-9]{8}$/.test(stage)) {
    throw new Error('Unexpected guest transfer staging directory');
  }
  try {
    for (let n = 0; n < bytes.length; n += CHUNK_BYTES) {
      const encoded = bytes.subarray(n, n + CHUNK_BYTES).toString('base64');
      await guestRun(client, id, `printf '%s' ${shellQuote(encoded)} >> ${shellQuote(`${stage}/content.b64`)}`);
    }
    if (bytes.length === 0) await guestRun(client, id, `: > ${shellQuote(`${stage}/content.b64`)}`);
    await guestRun(client, id, `${guestGuard(remote)} ` +
      `mkdir -p -- "$(dirname -- ${shellQuote(remote)})"; ` +
      `${guestGuard(remote)} test ! -L ${shellQuote(remote)}; ` +
      `base64 -d ${shellQuote(`${stage}/content.b64`)} > ${shellQuote(`${stage}/content`)}; ` +
      `chmod ${mode.toString(8)} ${shellQuote(`${stage}/content`)}; ` +
      `mv -f -- ${shellQuote(`${stage}/content`)} ${shellQuote(remote)}`);
    return bytes.length;
  } finally {
    await guestRun(client, id, `rm -rf -- ${shellQuote(stage)}`).catch(() => {});
  }
}

async function syncOutFile(client, id, host, remote, mode, hostRoot, limitRemaining) {
  const guard = guestGuard(remote);
  const sizeText = await guestRun(client, id, `${guard} test ! -L ${shellQuote(remote)}; ` +
    `test -f ${shellQuote(remote)}; wc -c < ${shellQuote(remote)}`);
  if (!/^\s*\d+\s*$/.test(sizeText)) throw new Error('Invalid guest file size');
  const claimed = Number(sizeText.trim());
  if (!Number.isSafeInteger(claimed) || claimed > MAX_FILE_BYTES || claimed > limitRemaining) throw new Error('Guest file exceeds experimental transfer limits');
  const encoded = await guestRun(client, id, `${guard} test ! -L ${shellQuote(remote)}; ` +
    `test -f ${shellQuote(remote)}; data=$(base64 ${shellQuote(remote)}); printf '%s' "$data" | tr -d '\\r\\n'`);
  if (encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !BASE64_PATTERN.test(encoded)) {
    throw new Error('Invalid or oversized guest base64 payload');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_FILE_BYTES || bytes.length !== claimed) throw new Error('Guest file size mismatch');
  const parent = path.dirname(host);
  const temporary = path.join(parent, `.paperclip-space-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, bytes, {flag:'wx',mode});
    await fs.chmod(temporary, mode);
    // Recheck path before atomic promotion; no writes outside local workspace.
    await assertHostFile(host, hostRoot, 'out');
    await fs.rename(temporary, host);
    return bytes.length;
  } finally {
    await fs.rm(temporary, {force:true});
  }
}

/** Official Paperclip sync operation shape. Experimental file-only transfer. */
export async function syncFiles(client, params, direction) {
  if (direction !== 'in' && direction !== 'out') throw new Error('Invalid synchronization direction');
  if (params.config?.transferMode !== 'command-experimental') {
    throw new Error('SPACE file transfer is disabled: requires explicit command-experimental opt-in');
  }
  const id = identifier(params.lease?.providerLeaseId, 'sbx_');
  const hostRoot = params.workspace?.localPath;
  if (typeof hostRoot !== 'string' || !path.isAbsolute(hostRoot)) throw new Error('Missing authorized local workspace');
  const ops = params.operations;
  if (!Array.isArray(ops)) throw new Error('Missing workspace sync operations');
  const validated = [];
  let count = 0;
  // Entire request is validated before any side effect or guest command.
  for (const op of ops) {
    if (typeof op?.operationId !== 'string' || !Array.isArray(op.files)) throw new Error('Invalid workspace sync operation');
    if (op.postUploadCommands?.length) throw new Error('Post-upload commands disabled in experimental transfer mode');
    const maps = [];
    for (const file of op.files) {
      if (++count > MAX_SYNC_FILES) throw new Error('Too many workspace transfer files');
      const mapping = validateMapping(file, direction);
      mapping.host = await assertHostFile(mapping.host, hostRoot, direction);
      maps.push(mapping);
    }
    validated.push({operationId:op.operationId, maps});
  }
  // For host-to-guest, preflight aggregate size before any VM mutation.
  if (direction === 'in') {
    let sum = 0;
    for (const op of validated) for (const file of op.maps) {
      const stat = await fs.lstat(file.host);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Host file exceeds experimental transfer limits');
      sum += stat.size;
      if (sum > MAX_SYNC_BYTES) throw new Error('Workspace transfer total size limit exceeded');
    }
  }
  const output = [];
  let total = 0;
  for (const op of validated) {
    let operationBytes = 0;
    for (const file of op.maps) {
      const n = direction === 'in'
        ? await syncInFile(client, id, file.host, file.remote, file.mode)
        : await syncOutFile(client, id, file.host, file.remote, file.mode, hostRoot, MAX_SYNC_BYTES - total);
      operationBytes += n;
      total += n;
      if (total > MAX_SYNC_BYTES) throw new Error('Workspace transfer total size limit exceeded');
    }
    output.push({operationId:op.operationId, filesTransferred:op.maps.length, bytesTransferred:operationBytes});
  }
  return {operations:output};
}
