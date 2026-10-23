/**
 * Disposable SPACE integration test for native-incubating file sync.
 *
 * Never auto-runs from Jenkins or npm test. It creates a real Firecracker VM.
 * Explicit opt-in with SPACE_INTEGRATION_CONFIRM=DISPOSABLE_VM_ONLY is required.
 *
 * Only random synthetic data is transferred; never source repositories/secrets.
 * On uncertain VM creation/deletion, reconcile manually rather than retry POST.
 */
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {SpaceClient} from '../src/space-client.js';
import {syncNativeFiles} from '../src/native-workspace-sync.js';

const ROOT='/paperclip-workspace';
const confirmation='DISPOSABLE_VM_ONLY';

function assertConfiguration(env) {
  if (env.SPACE_INTEGRATION_CONFIRM !== confirmation) {
    throw new Error('Refusing to create VM. Set SPACE_INTEGRATION_CONFIRM=DISPOSABLE_VM_ONLY after reviewing the test.');
  }
  if (env.CI === 'true' && env.SPACE_ALLOW_CI_INTEGRATION !== 'true') {
    throw new Error('Refusing an automatic Jenkins/CI integration run');
  }
  for (const key of ['SPACE_API_URL','SPACE_DATA_PLANE_URL','SPACE_API_TOKEN']) {
    if (!env[key]) throw new Error(key+' must be set privately; never commit tokens');
  }
}
const sum=(data)=>createHash('sha256').update(data).digest('hex');
const mapping=(sourcePath,targetPath,kind='file',exclude=[])=>({
  sourcePath,targetPath,kind,followSymlinks:false,exclude
});
const invocation=(config,hostRoot,sandboxId,mappings)=>({
  config,workspace:{localPath:hostRoot},lease:{providerLeaseId:sandboxId},
  operations:[{operationId:'native-smoke-'+randomUUID(),files:mappings}]
});

function requireEqual(actual,expected,label) {
  if (actual !== expected) throw new Error(label+' did not match');
}
async function assertFile(name,expected) {
  const actual=await fs.readFile(name);
  requireEqual(actual.length,expected.length,'Byte count for '+path.basename(name));
  requireEqual(sum(actual),sum(expected),'SHA-256 for '+path.basename(name));
}
async function assertAbsent(name) {
  try {await fs.lstat(name);}
  catch(err) {if (err?.code==='ENOENT') return;throw err;}
  throw new Error('An excluded file was transferred');
}

export async function run(env=process.env,{SpaceClientClass=SpaceClient,sync=syncNativeFiles}={}) {
  // No network or local workspace mutation before the user's explicit consent.
  assertConfiguration(env);
  const config={
    apiUrl:env.SPACE_API_URL,
    dataPlaneUrl:env.SPACE_DATA_PLANE_URL,
    apiToken:env.SPACE_API_TOKEN,
    template:env.SPACE_TEMPLATE || 'seed:latest',
    allowInsecurePrivateHttp:env.SPACE_ALLOW_INSECURE_PRIVATE_HTTP==='true',
    transferMode:'native-incubating',
  };
  const client=new SpaceClientClass(config);
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'space-native-integration-'));
  let id=null;
  let failed=false;
  let cleanupFailed=false;
  try {
    const input=path.join(tmp,'fixture');
    const output=path.join(tmp,'download');
    await fs.mkdir(path.join(input,'nested'),{recursive:true,mode:0o700});
    await fs.mkdir(path.join(input,'.git'),{recursive:true,mode:0o700});

    // Synthetic/nonsecret fixtures only. No working tree contents are accessed.
    const fixtures=new Map([
      ['hello.txt',Buffer.from('paperclip-space-native-integration\n')],
      ['empty.txt',Buffer.alloc(0)],
      ['nested/binary.bin',randomBytes(750_000)],
      ['nested/notes.md',Buffer.from('# Test-only fixture\n')],
    ]);
    for(const [name,bytes] of fixtures) {
      await fs.writeFile(path.join(input,name),bytes,{mode:0o600});
    }
    await fs.writeFile(path.join(input,'.git','config'),'SYNTHETIC-EXCLUDED-NONSECRET',{mode:0o600});

    // Creating a sandbox can have an unknown outcome if the API times out.
    // In that case, this program does not blindly retry creation.
    console.log('[native-smoke] Creating a disposable SPACE Firecracker sandbox');
    id=await client.create();
    console.log('[native-smoke] Sandbox ID:',id);
    await client.ensureWorkspace(id);

    const guest=ROOT+'/native-sync-test-'+randomUUID();
    console.log('[native-smoke] Uploading artificial fixture files through SPACE native file API');
    const up=await sync(client,invocation(config,tmp,id,[
      mapping(input,guest,'directory',['.git'])
    ]),'in');
    requireEqual(up.operations.length,1,'Upload operation count');
    requireEqual(up.operations[0].filesTransferred,fixtures.size,'Uploaded file count');
    const bytes=[...fixtures.values()].reduce((n,buffer)=>n+buffer.length,0);
    requireEqual(up.operations[0].bytesTransferred,bytes,'Uploaded byte count');

    console.log('[native-smoke] Downloading synthetic files to a separate local directory');
    const down=await sync(client,invocation(config,tmp,id,[
      mapping(guest,output,'directory',['.git'])
    ]),'out');
    requireEqual(down.operations.length,1,'Download operation count');
    requireEqual(down.operations[0].filesTransferred,fixtures.size,'Downloaded file count');
    requireEqual(down.operations[0].bytesTransferred,bytes,'Downloaded byte count');

    for(const [name,expected] of fixtures) {
      await assertFile(path.join(output,name),expected);
    }
    await assertAbsent(path.join(output,'.git','config'));

    // Exercise a single-file mapping separately from directory mappings.
    const single=path.join(tmp,'single-output.txt');
    const extra=await sync(client,invocation(config,tmp,id,[
      mapping(guest+'/hello.txt',single)
    ]),'out');
    requireEqual(extra.operations[0].filesTransferred,1,'Single-file count');
    await assertFile(single,fixtures.get('hello.txt'));

    console.log('[native-smoke] PASS: binary, empty, nested, excluded and single-file roundtrips');
  } catch(error) {
    failed=true;
    // SPACE errors have sanitized messages; never log env/config/token or data.
    console.error('[native-smoke] FAILED:',error instanceof Error?error.message:'Unexpected error');
    if(!id) console.error('[native-smoke] Unknown create outcome: inspect SPACE for orphan VMs; do not retry blindly');
  } finally {
    if (id) {
      try {
        console.log('[native-smoke] Deleting disposable sandbox:',id);
        await client.destroy(id);
        console.log('[native-smoke] Delete confirmed:',id);
      } catch(error) {
        cleanupFailed=true;
        console.error('[native-smoke] DELETE UNCONFIRMED for',id,'— inspect/delete manually before rerunning.');
        console.error('[native-smoke] Cleanup error:',error instanceof Error?error.message:'Unknown error');
      }
    }
    await fs.rm(tmp,{force:true,recursive:true}).catch(()=>{
      failed=true;
      console.error('[native-smoke] Could not delete local synthetic fixture directory:',tmp);
    });
  }
  if(failed||cleanupFailed) throw new Error('SPACE native integration did not fully succeed; inspect the log and reconcile before retry');
  return {ok:true};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  run().catch(e=>{
    console.error('[native-smoke]',e instanceof Error?e.message:'Integration failed');
    process.exitCode=1;
  });
}
