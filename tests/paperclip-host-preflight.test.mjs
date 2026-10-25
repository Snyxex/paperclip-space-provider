import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyBundle,getOrigins,verifyManagementSchema,checkManagement
} from '../scripts/paperclip-host-preflight.mjs';

const manifest={
  id:'community.space-sandbox-provider',
  apiVersion:1,version:'0.1.0-alpha.1',
  capabilities:['environment.drivers.register'],
  environmentDrivers:[{
    driverKey:'space',kind:'sandbox_provider',
    configSchema:{required:['apiToken','apiUrl','dataPlaneUrl']}
  }]
};
const pkg={name:'paperclip-space-provider',private:true,paperclipPlugin:{
  manifest:'./dist/manifest.js',worker:'./dist/worker.js'
}};
const hooks=[
  'onEnvironmentValidateConfig','onEnvironmentProbe',
  'onEnvironmentAcquireLease','onEnvironmentReleaseLease',
  'onEnvironmentDestroyLease','onEnvironmentRealizeWorkspace',
  'onEnvironmentExecute','onEnvironmentSyncIn','onEnvironmentSyncOut'
];
const plugin=Object.fromEntries(hooks.map(name=>[name,()=>{}]));
const schema={openapi:'3.1.0',info:{version:'0.8.0'},paths:{
  '/sandboxes':{post:{}},
  '/sandboxes/{sandbox_id}':{delete:{}},
  '/sandboxes/{sandbox_id}/commands':{post:{}},
  '/sessions/{session_id}/events':{get:{}}
}};

test('Paperclip host package verifies manifest, driver and worker hooks',()=>{
 const r=verifyBundle(pkg,manifest,plugin);
 assert.equal(r.driverKey,'space');
 assert.equal(r.pluginId,manifest.id);
 assert.throws(()=>verifyBundle(pkg,manifest,{...plugin,onEnvironmentExecute:null}),/onEnvironmentExecute/);
 assert.throws(()=>verifyBundle(pkg,{...manifest,environmentDrivers:[]},plugin),/driver/);
 assert.throws(()=>verifyBundle({...pkg,private:false},manifest,plugin),/package metadata/);
});

test('Paperclip worker URL validation permits loopback and rejects public HTTP',()=>{
 const local=getOrigins({
   SPACE_API_URL:'http://127.0.0.1:18080',
   SPACE_DATA_PLANE_URL:'http://127.0.0.1:18090'
 });
 assert.equal(local.apiUrl,'http://127.0.0.1:18080');
 assert.throws(()=>getOrigins({
   SPACE_API_URL:'http://public.example.invalid',
   SPACE_DATA_PLANE_URL:'http://127.0.0.1:18090'
 }),/HTTPS/);
 assert.throws(()=>getOrigins({}),/required/);
 assert.throws(()=>getOrigins({
   SPACE_API_URL:'http://100.64.0.1:18080',
   SPACE_DATA_PLANE_URL:'https://data.example.invalid',
   SPACE_ALLOW_INSECURE_PRIVATE_HTTP:'true'
 }),/HTTPS/);
 // CGNAT/Tailscale addresses are not RFC1918 and must use HTTPS.
});


test('OpenAPI preflight requires management, commands and SSE routes',async()=>{
 assert.equal(verifyManagementSchema(schema),'0.8.0');
 const missing=structuredClone(schema);
 delete missing.paths['/sandboxes/{sandbox_id}/commands'];
 assert.throws(()=>verifyManagementSchema(missing),/command execution/);
 const result=await checkManagement('https://api.example.invalid',async(url,options)=>{
   assert.equal(url,'https://api.example.invalid/openapi-m1.json');
   assert.equal(options.method,'GET');
   assert.equal(options.headers.Accept,'application/json');
   return new Response(JSON.stringify(schema),{status:200});
 });
 assert.equal(result,'0.8.0');
 await assert.rejects(
   checkManagement('https://api.example.invalid',async()=>new Response('Unavailable',{status:503})),
   /HTTP 503/
 );
});
