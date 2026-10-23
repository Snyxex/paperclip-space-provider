import {definePlugin} from '@paperclipai/plugin-sdk';
import {parseConfig, WORKSPACE} from './config.js';
import {SpaceClient} from './space-client.js';
import {syncFiles} from './workspace-sync.js';

let context = null;
const client = (params) => new SpaceClient(params.config);
const metadata = (id, params) => ({provider:'space', sandboxId:id, remoteCwd:WORKSPACE,
  shellCommand:'sh', companyId:params.companyId, environmentId:params.environmentId});
function checkLease(params) {
  const id = params.lease?.providerLeaseId;
  if (!id || params.lease.metadata?.provider !== 'space' ||
    params.lease.metadata?.companyId !== params.companyId ||
    params.lease.metadata?.environmentId !== params.environmentId) throw new Error('SPACE lease belongs to another environment or is missing');
  return id;
}

const plugin = definePlugin({
  async setup(ctx) {context=ctx; ctx.logger.info('SPACE alpha provider worker ready');},
  async onHealth() {return {status:'ok', message:'SPACE plugin loaded; use environment probe to check connectivity'};},
  async onEnvironmentValidateConfig(params) {
    try {
      const {token, ...normal} = parseConfig(params.config);
      return {ok:true, normalizedConfig: {...normal, apiToken:params.config.apiToken}};
    } catch (e) {return {ok:false, errors:[e instanceof Error?e.message:'Invalid configuration']};}
  },
  async onEnvironmentProbe(params) {
    let id = null; let failed = null;
    try {
      const c = client(params);
      id = await c.create();
      const r = await c.exec(id, 'sh', ['-c', 'printf space-provider-ready']);
      if (r.exitCode !== 0 || r.stdout !== 'space-provider-ready') throw new Error('SPACE command test failed');
    } catch (e) {failed = e instanceof Error?e.message:'SPACE probe failed';}
    finally {
      if (id) {
        try {await client(params).destroy(id);} catch {failed = `SPACE probe cleanup unconfirmed for ${id}; inspect manually`;}
      }
    }
    return failed ? {ok:false, summary:failed} : {ok:true, summary:'SPACE created, executed, and deleted a Firecracker sandbox'};
  },
  async onEnvironmentAcquireLease(params) {
    if (params.requestedExpiresAt) throw new Error('SPACE alpha cannot guarantee lease expiration');
    const c = client(params);
    const id = await c.create();
    try {await c.ensureWorkspace(id);} catch {
      throw new Error(`Sandbox ${id} exists but workspace preparation failed; cleanup required`);
    }
    return {providerLeaseId:id, metadata:metadata(id,params)};
  },
  async onEnvironmentResumeLease(params) {
    // Lease reuse across Paperclip runs is deliberately disabled in the initial version.
    return {providerLeaseId:null, metadata:{expired:true}};
  },
  async onEnvironmentReleaseLease(params) {
    if (!params.providerLeaseId) return;
    if (params.leaseMetadata?.provider !== 'space' || params.leaseMetadata?.companyId !== params.companyId || params.leaseMetadata?.environmentId !== params.environmentId) {
      throw new Error('SPACE lease ownership mismatch');
    }
    await client(params).destroy(params.providerLeaseId);
  },
  async onEnvironmentDestroyLease(params) {
    if (!params.providerLeaseId) return;
    if (params.leaseMetadata?.provider !== 'space' || params.leaseMetadata?.companyId !== params.companyId || params.leaseMetadata?.environmentId !== params.environmentId) {
      throw new Error('SPACE lease ownership mismatch');
    }
    await client(params).destroy(params.providerLeaseId);
  },
  async onEnvironmentRealizeWorkspace(params) {
    const id = checkLease(params);
    await client(params).ensureWorkspace(id);
    return {cwd:WORKSPACE, metadata:{provider:'space', remoteCwd:WORKSPACE}};
  },
  async onEnvironmentSyncIn(params) {
    checkLease(params);
    return syncFiles(client(params), params, 'in');
  },
  async onEnvironmentSyncOut(params) {
    checkLease(params);
    return syncFiles(client(params), params, 'out');
  },
  async onEnvironmentExecute(params) {
    const id = checkLease(params);
    return client(params).exec(id, params.command, params.args ?? [],
      {cwd:params.cwd, env:params.env, timeoutMs:params.timeoutMs, stdin:params.stdin},
      (stream,text)=>context?.execution.log(stream,text));
  },
  async onShutdown() {context=null;}
});
export default plugin;
