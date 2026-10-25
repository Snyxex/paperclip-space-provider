/**
 * Credential-free Paperclip plugin package and reachability preflight.
 *
 * Package checks are safe for Jenkins PRs. --connectivity performs only
 * unauthenticated reads / transport handshakes; it never creates a VM.
 */
import {readFile} from 'node:fs/promises';
import {connect as tcpConnect, isIP} from 'node:net';
import {connect as tlsConnect} from 'node:tls';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseConfig} from '../src/config.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const requiredHooks=[
  'onEnvironmentValidateConfig','onEnvironmentProbe',
  'onEnvironmentAcquireLease','onEnvironmentReleaseLease',
  'onEnvironmentDestroyLease','onEnvironmentRealizeWorkspace',
  'onEnvironmentExecute','onEnvironmentSyncIn','onEnvironmentSyncOut'
];

export function verifyBundle(pkg, manifest, plugin) {
  if(pkg.name!=='paperclip-space-provider' || pkg.private!==true)
    throw new Error('Unexpected package metadata for local alpha plugin');
  if(pkg.paperclipPlugin?.manifest!=='./dist/manifest.js' ||
     pkg.paperclipPlugin?.worker!=='./dist/worker.js')
    throw new Error('Paperclip manifest/worker entrypoints are inconsistent');
  if(manifest?.apiVersion!==1 || manifest.id!=='community.space-sandbox-provider' ||
     !manifest.capabilities?.includes('environment.drivers.register'))
    throw new Error('SPACE plugin manifest is incompatible');
  const drivers=manifest.environmentDrivers?.filter(d=>d.driverKey==='space');
  if(drivers?.length!==1 || drivers[0].kind!=='sandbox_provider')
    throw new Error('SPACE sandbox environment driver is missing');
  for(const key of ['apiToken','apiUrl','dataPlaneUrl']) {
    if(!drivers[0].configSchema?.required?.includes(key))
      throw new Error('Missing mandatory SPACE environment config field: '+key);
  }
  // Paperclip SDK definePlugin() returns {definition}, not the hooks
  // directly on the exported sealed object.
  for(const name of requiredHooks) {
    if(typeof plugin?.definition?.[name]!=='function')
      throw new Error('Missing SPACE worker lifecycle hook: '+name);
  }
  return {pluginId:manifest.id,version:manifest.version,driverKey:'space'};
}

export async function checkBundle(packageRoot=root) {
  const pkg=JSON.parse(await readFile(path.join(packageRoot,'package.json'),'utf8'));
  const [manifest, plugin]=await Promise.all([
    import(pathToFileURL(path.join(packageRoot,'dist/manifest.js')).href).then(m=>m.default),
    import(pathToFileURL(path.join(packageRoot,'dist/plugin.js')).href).then(m=>m.default)
  ]);
  return verifyBundle(pkg,manifest,plugin);
}

export function getOrigins(env) {
  // Reuse the provider's own URL policy without requiring or reading a real
  // management token. HTTP to a non-loopback private IP requires opt-in.
  const config=parseConfig({
    apiUrl:env.SPACE_API_URL,
    dataPlaneUrl:env.SPACE_DATA_PLANE_URL,
    apiToken:'unused-preflight-placeholder',
    allowInsecurePrivateHttp:env.SPACE_ALLOW_INSECURE_PRIVATE_HTTP==='true'
  });
  return {apiUrl:config.apiUrl,dataPlaneUrl:config.dataPlaneUrl};
}

export function verifyManagementSchema(schema) {
  if(typeof schema?.openapi!=='string' || !schema.openapi.startsWith('3.'))
    throw new Error('SPACE management OpenAPI document is invalid');
  if(!schema.paths?.['/sandboxes']?.post || !schema.paths?.['/sandboxes/{sandbox_id}']?.delete)
    throw new Error('SPACE management API lacks sandbox lifecycle endpoints');
  if(!schema.paths?.['/sandboxes/{sandbox_id}/commands']?.post)
    throw new Error('SPACE management API lacks command execution endpoint');
  if(!schema.paths?.['/sessions/{session_id}/events']?.get)
    throw new Error('SPACE OpenAPI lacks command stream endpoint');
  return String(schema.info?.version??'unknown');
}

export async function checkManagement(apiUrl,fetchImpl=fetch) {
  const response=await fetchImpl(apiUrl+'/openapi-m1.json',{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(6000),
    headers:{'Accept':'application/json'}
  });
  if(!response.ok)
    throw new Error('SPACE OpenAPI request returned HTTP '+response.status);
  return verifyManagementSchema(await response.json());
}

export function checkDataPlane(dataPlaneUrl,timeoutMs=6000) {
  const uri=new URL(dataPlaneUrl);
  const hostname=uri.hostname.replace(/^\[|\]$/g,'');
  const port=Number(uri.port||(uri.protocol==='https:'?'443':'80'));
  return new Promise((resolve,reject)=>{
    const params={host:hostname,port};
    const socket=uri.protocol==='https:'
      ? tlsConnect({...params,...(isIP(hostname)?{}:{servername:hostname})})
      : tcpConnect(params);
    const connected=uri.protocol==='https:'?'secureConnect':'connect';
    socket.setTimeout(timeoutMs,()=>socket.destroy(new Error('SPACE data-plane connection timed out')));
    socket.once('error',reject);
    socket.once(connected,()=>{
      socket.destroy();
      resolve();
    });
  });
}

async function main() {
  const bundle=await checkBundle();
  console.log('[paperclip-host] Plugin package OK: '+bundle.pluginId+' '+bundle.version);
  if(!process.argv.includes('--connectivity')) {
    console.log('[paperclip-host] No network checks requested; pass --connectivity on the Paperclip worker host.');
    return;
  }
  const origins=getOrigins(process.env);
  const version=await checkManagement(origins.apiUrl);
  console.log('[paperclip-host] SPACE management reachable: OpenAPI version '+version);
  await checkDataPlane(origins.dataPlaneUrl);
  console.log('[paperclip-host] SPACE data-plane TCP/TLS endpoint reachable (stream authorization not tested).');
  console.log('[paperclip-host] PASS: package and network preflight (no VM created).');
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{
    console.error('[paperclip-host] FAIL: '+(error instanceof Error?error.message:'Unexpected error'));
    process.exitCode=1;
  });
}
