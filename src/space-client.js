import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {identifier, parseConfig, shellQuote, WORKSPACE} from './config.js';
import {readCommandEvents} from './sse.js';

export class SpaceError extends Error {
  constructor(message, status = null) {super(message); this.name = 'SpaceError'; this.status = status;}
}
function bodyObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new SpaceError('Invalid SPACE JSON response');
  return obj;
}
export class SpaceClient {
  constructor(raw, fetchImpl = fetch) {this.config = parseConfig(raw); this.fetchImpl = fetchImpl;}
  async request(origin, path, {method='GET', body, key, token, timeoutMs} = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Unsafe SPACE API path');
    const ms = timeoutMs ?? this.config.timeoutMs;
    let response;
    try {
      response = await this.fetchImpl(origin + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(ms),
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token ?? this.config.token}`,
          ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
          ...(key ? {'Idempotency-Key': key} : {}),
        },
        ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
      });
    } catch {throw new SpaceError('SPACE API request failed or timed out (no automatic mutation retry)');}
    if (!response.ok) {await response.body?.cancel().catch(() => {}); throw new SpaceError(`SPACE API returned HTTP ${response.status}`, response.status);}
    try {return bodyObject(await response.json());} catch {throw new SpaceError('SPACE returned invalid JSON');}
  }
  api(path, options) {return this.request(this.config.apiUrl, path, options);}
  async readFile(id, guestPath, offset, length) {
    id = identifier(id, 'sbx_');
    if (typeof guestPath !== 'string' || !guestPath.startsWith('/paperclip-workspace/') ||
        guestPath.includes('\0') || guestPath.includes('\\') ||
        guestPath.split('/').includes('..') || path.posix.normalize(guestPath) !== guestPath ||
        !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isInteger(length) || length < 1 || length > 512*1024) {
      throw new SpaceError('Invalid SPACE native file read');
    }
    let response;
    try {
      response = await this.fetchImpl(this.config.apiUrl + '/v1/sandboxes/' + id + '/files:read', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: {
          'Accept':'application/octet-stream',
          'Content-Type':'application/json',
          'Authorization':'Bearer '+this.config.token,
        },
        body:JSON.stringify({path:guestPath, offset, length}),
      });
    } catch { throw new SpaceError('SPACE native file read failed or timed out'); }
    if (!response.ok) {
      await response.body?.cancel().catch(()=>{});
      throw new SpaceError('SPACE native file read HTTP '+response.status,response.status);
    }
    if (!response.headers.get('content-type')?.startsWith('application/octet-stream') ||
        !response.body) throw new SpaceError('SPACE native file read returned an invalid response type');
    const reader = response.body.getReader();
    const chunks = [];
    let count = 0;
    try {
      for (;;) {
        const {value,done} = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new SpaceError('SPACE native file read produced invalid bytes');
        count += value.byteLength;
        if (count > length) throw new SpaceError('SPACE native file read exceeded request limit');
        chunks.push(Buffer.from(value));
      }
    } catch {
      await reader.cancel().catch(()=>{});
      throw new SpaceError('SPACE native file read stream was incomplete or oversized');
    } finally { reader.releaseLock(); }
    if (count !== length) throw new SpaceError('SPACE native file read length mismatch');
    return Buffer.concat(chunks,count);
  }

  async wait(path, state, timeoutMs = this.config.timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const data = await this.api(path, {timeoutMs: Math.min(30_000, Math.max(1000, deadline - Date.now()))});
      if (data.state === state) return data;
      if (['failed', 'canceled', 'expired', 'deleted', 'deleting', 'stopped'].includes(data.state)) throw new SpaceError(`SPACE state ${data.state}; expected ${state}`);
      if (Date.now() >= deadline) throw new SpaceError(`Timed out waiting for SPACE state ${state}`);
      await sleep(1000);
    }
  }
  async create() {
    const body = {template: this.config.template, runtime: 'fc'};
    if (Object.keys(this.config.resources).length) body.resources = this.config.resources;
    // Do not blindly retry POST: an unknown response may have created the VM.
    const created = await this.api('/v1/sandboxes', {method: 'POST', body, key: randomUUID()});
    const sandboxId = identifier(created.sandbox_id, 'sbx_');
    try {
      const operationId = identifier(created.operation_id, 'op_');
      await this.wait(`/v1/operations/${operationId}`, 'succeeded');
      await this.wait(`/v1/sandboxes/${sandboxId}`, 'running');
      const processes = await this.api(`/v1/sandboxes/${sandboxId}/processes?limit=1`);
      if (!Array.isArray(processes.data)) throw new SpaceError('Sandbox readiness response is invalid');
    } catch (err) {
      // SPACE returned an owned sandbox ID. Best-effort delete exactly this
      // instance before returning a failure. Never re-send the create request:
      // its outcome is already known enough to need reconciliation.
      // A failed delete is NOT proof that the VM is gone.
      const reason = err instanceof Error ? err.message.slice(0, 240) : 'Unknown readiness failure';
      try {
        await this.destroy(sandboxId);
      } catch {
        throw new SpaceError(`Sandbox ${sandboxId} readiness failed; cleanup unconfirmed. Inspect and reconcile this sandbox before retrying. Cause: ${reason}`);
      }
      throw new SpaceError(`Sandbox ${sandboxId} readiness failed; deletion confirmed. Cause: ${reason}`);
    }
    return sandboxId;
  }
  async inspect(id) {return this.api(`/v1/sandboxes/${identifier(id, 'sbx_')}`);}
  async destroy(id) {
    id = identifier(id, 'sbx_');
    const result = await this.api(`/v1/sandboxes/${id}`, {method: 'DELETE', key: randomUUID()});
    const opId = identifier(result.operation_id, 'op_');
    await this.wait(`/v1/operations/${opId}`, 'succeeded');
  }
  async exec(id, command, args = [], options = {}, log = () => {}) {
    id = identifier(id, 'sbx_');
    if (typeof command !== 'string' || !command || !Array.isArray(args) || args.some(x=>typeof x !== 'string')) throw new Error('Invalid command');
    if (options.stdin !== undefined && options.stdin !== null) throw new Error('Sandbox stdin staging not yet supported in alpha');
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3_600_000) throw new Error('Invalid command timeout');
    const env = options.env ?? {};
    const assignments = Object.entries(env).map(([key, value])=>{
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string') throw new Error('Invalid environment variable');
      return `${key}=${shellQuote(value)}`;
    });
    // Use POSIX shell exports rather than assuming the guest contains `env`.
    const exports = assignments.map(x => `export ${x}`).join('; ');
    const invocation = `exec ${[command, ...args].map(shellQuote).join(' ')}`;
    const script = exports ? `${exports}; ${invocation}` : invocation;
    const cwd = options.cwd;
    if (cwd !== undefined && (typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.includes('\0'))) throw new Error('Invalid sandbox working directory');
    const payload = {command: ['sh', '-c', script], timeout: `${Math.ceil(timeoutMs/1000)}s`, ...(cwd ? {cwd} : {})};
    // Never retry command creation blindly; it may already be executing.
    const result = await this.api(`/v1/sandboxes/${id}/commands`, {method: 'POST', body: payload, key: randomUUID()});
    const sessionId = identifier(result.session_id, 'proc_');
    const eventsPath = `/v1/sessions/${sessionId}/events`;
    const fullUrl = this.config.dataPlaneUrl + eventsPath;
    if (result.attach?.events_url !== eventsPath && result.attach?.events_url !== fullUrl) throw new SpaceError('SPACE returned an unexpected command stream destination');
    if (typeof result.attach.token !== 'string' || !result.attach.token) throw new SpaceError('SPACE command attach token is missing');
    let response;
    try {
      response = await this.fetchImpl(fullUrl, {
        method:'GET', redirect:'error',
        headers: {'Authorization': `Bearer ${result.attach.token}`, 'Accept': 'text/event-stream'},
        signal: AbortSignal.timeout(timeoutMs + 15_000),
      });
    } catch {throw new SpaceError('SPACE command stream failed; do not rerun the command automatically');}
    return readCommandEvents(response, log);
  }
  async ensureWorkspace(id) {
    // The published SPACE seed guest runs as 'user' (UID 2000) and cannot
    // write under '/'. Bootstrap just this fixed path inside the disposable VM.
    // Custom templates with an existing writable directory need no sudo.
    const script = `set -eu
if [ -L '${WORKSPACE}' ]; then
  echo 'Refusing symlink workspace' >&2; exit 1
fi
if [ ! -d '${WORKSPACE}' ]; then
  if [ -e '${WORKSPACE}' ]; then
    echo 'Workspace path exists but is not a directory' >&2; exit 1
  fi
  if [ "$(id -u)" != "2000" ] || [ "$(id -un)" != "user" ]; then
    echo 'Workspace bootstrap requires the standard SPACE seed user' >&2; exit 1
  fi
  sudo -n install -d -m 0700 -o user -g user -- '${WORKSPACE}'
fi
if [ ! -w '${WORKSPACE}' ] || [ ! -x '${WORKSPACE}' ]; then
  echo 'Workspace is not writable by the guest user' >&2; exit 1
fi`;
    const r = await this.exec(id, 'sh', ['-c', script]);
    if (r.exitCode !== 0) {
      const detail = typeof r.stderr === 'string'
        ? r.stderr.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 240) : '';
      const exit = Number.isInteger(r.exitCode) ? `exit ${r.exitCode}` : 'unknown exit status';
      throw new SpaceError(`Could not prepare sandbox workspace (${exit}${detail ? `: ${detail}` : ''})`);
    }
    return WORKSPACE;
  }
}
