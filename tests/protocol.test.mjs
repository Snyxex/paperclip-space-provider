import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConfig, shellQuote} from '../src/config.js';
import {readCommandEvents} from '../src/sse.js';
import {SpaceClient} from '../src/space-client.js';
const settings={apiToken:'test-token',apiUrl:'http://172.20.0.1:18080',dataPlaneUrl:'http://172.20.0.1:18090',allowInsecurePrivateHttp:true};
const json=o=>new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}});
function sse(chunks){return new Response(new ReadableStream({start(c){for(const x of chunks)c.enqueue(new TextEncoder().encode(x));c.close()}}),{status:200,headers:{'content-type':'text/event-stream'}})}
test('config requires explicit private HTTP and rejects public plaintext',()=>{
 assert.equal(parseConfig(settings).apiUrl,settings.apiUrl);
 assert.throws(()=>parseConfig({...settings,apiUrl:'http://example.com'}),/HTTPS/);
 assert.throws(()=>parseConfig({...settings,allowInsecurePrivateHttp:false}),/HTTPS/);
 assert.throws(()=>parseConfig({...settings,apiUrl:'http://169.254.169.254'}),/HTTPS/);
 assert.throws(()=>parseConfig({...settings,apiUrl:'https://host.example/path'}),/origin/);
 assert.throws(()=>parseConfig({...settings,reuseLease:true}),/not yet supported/);
});
test('shell quoting rejects NUL and preserves single quote',()=>{
 assert.equal(shellQuote("it's"),"'it'"+'"'+ "'" +'"' +"'s'");
 assert.throws(()=>shellQuote('a\0b'),/Invalid/);
});
test('SSE chunked UTF8 decoding and nonzero process exit',async()=>{
 const a=Buffer.from('äB').toString('base64');
 const raw=': keepalive\n\ndata: '+JSON.stringify({type:'stdout',data_base64:a})+'\n\ndata: '+JSON.stringify({type:'process_exited',exit_code:3})+'\n\n';
 const r=await readCommandEvents(sse([raw.slice(0,15),raw.slice(15,47),raw.slice(47)]));
 assert.equal(r.stdout,'äB');assert.equal(r.exitCode,3);assert.equal(r.timedOut,false);
});
test('SSE disconnect is not execution success',async()=>{
 await assert.rejects(readCommandEvents(sse(['data: {"type":"stdout","data_base64":"YQ=="}\n\n'])),/without process_exited/);
});
test('resync_required makes command outcome uncertain',async()=>{
 await assert.rejects(readCommandEvents(sse(['data: {"type":"resync_required"}\n\n'])),/outcome is uncertain/);
});
test('invalid base64 is rejected',async()=>{
 await assert.rejects(readCommandEvents(sse(['data: {"type":"stdout","data_base64":"???"}\n\n'])),/Invalid base64/);
});
test('SPACE mutations, scoped stream attachment and cleanup',async()=>{
 const calls=[], sandbox='sbx_test', create='op_created', del='op_deleted', session='proc_test';
 const mocked=async(url,opts)=>{
   calls.push({url,opts});const path=new URL(url).pathname;
   if(path==='/v1/sandboxes'&&opts.method==='POST')return json({sandbox_id:sandbox,operation_id:create});
   if(path==='/v1/operations/'+create||path==='/v1/operations/'+del)return json({state:'succeeded'});
   if(path==='/v1/sandboxes/'+sandbox&&opts.method==='GET')return json({state:'running'});
   if(path==='/v1/sandboxes/'+sandbox+'/processes')return json({data:[]});
   if(path==='/v1/sandboxes/'+sandbox+'/commands')return json({session_id:session,attach:{token:'stream-token',events_url:'/v1/sessions/'+session+'/events'}});
   if(path==='/v1/sessions/'+session+'/events')return sse(['data: {"type":"stdout","data_base64":"aGk="}\n\n','data: {"type":"process_exited","exit_code":0}\n\n']);
   if(path==='/v1/sandboxes/'+sandbox&&opts.method==='DELETE')return json({operation_id:del});
   throw new Error('Unexpected test request '+path);
 };
 const c=new SpaceClient(settings,mocked);
 const id=await c.create();assert.equal(id,sandbox);
 const result=await c.exec(id,'sh',['-c','echo hi']);assert.equal(result.stdout,'hi');assert.equal(result.exitCode,0);
 await c.destroy(id);
 assert.equal(calls.find(c=>c.url.endsWith('/events')).opts.headers.Authorization,'Bearer stream-token');
 assert.equal(calls.find(c=>c.url.endsWith('/commands')).opts.headers.Authorization,'Bearer test-token');
 assert.ok(calls.find(c=>c.opts.method==='POST').opts.headers['Idempotency-Key']);
 assert.ok(calls.find(c=>c.opts.method==='DELETE').opts.headers['Idempotency-Key']);
});
test('unknown POST outcomes are not retried automatically',async()=>{
 let attempts=0;const c=new SpaceClient(settings,async()=>{attempts++;throw new Error('network failure')});
 await assert.rejects(c.create(),/request failed or timed out/);assert.equal(attempts,1);
});


test('guest execution does not require an external env binary',async()=>{
 const requests=[];
 const fetchMock=async(url,opts)=>{
   const pathname=new URL(url).pathname;
   if(pathname.endsWith('/commands')) {
     requests.push(JSON.parse(opts.body));
     return json({session_id:'proc_test',attach:{events_url:'/v1/sessions/proc_test/events',token:'stream-token'}});
   }
   if(pathname.endsWith('/events')) return sse(['data: {"type":"process_exited","exit_code":0}\n\n']);
   throw new Error('Unexpected request: '+pathname);
 };
 const client=new SpaceClient(settings,fetchMock);
 await client.exec('sbx_test','mkdir',['-p','/paperclip-workspace']);
 assert.equal(requests[0].command[2],"exec 'mkdir' '-p' '/paperclip-workspace'");
 await client.exec('sbx_test','printf',['ok'],{env:{GREETING:"it's fine"}});
 assert.equal(requests[1].command[2],`export GREETING=${shellQuote("it's fine")}; exec 'printf' 'ok'`);
});

test('workspace mkdir failures show bounded guest stderr and exit status',async()=>{
 const client=new SpaceClient(settings);
 client.exec=async()=>({exitCode:1,stderr:'mkdir: cannot create directory /paperclip-workspace: Permission denied\n'});
 await assert.rejects(client.ensureWorkspace('sbx_test'),/exit 1: mkdir: cannot create directory \/paperclip-workspace: Permission denied/);
 client.exec=async()=>({exitCode:127,stderr:'x'.repeat(500)});
 await assert.rejects(client.ensureWorkspace('sbx_test'),error=>{
   assert.equal(error.name,'SpaceError');
   assert.ok(error.message.length<350);
   return true;
 });
});

test('workspace bootstrap is confined to a fixed guest path and standard seed user',async()=>{
 const client=new SpaceClient(settings);
 let observed;
 client.exec=async(id, command, args)=>{
   assert.equal(id,'sbx_test');
   assert.equal(command,'sh');
   assert.equal(args[0],'-c');
   observed=args[1];
   return {exitCode:0,stderr:''};
 };
 assert.equal(await client.ensureWorkspace('sbx_test'),'/paperclip-workspace');
 assert.match(observed,/if \[ -L '\/paperclip-workspace' \]/);
 assert.match(observed,/\[ "\$\(id -u\)" != "2000" \]/);
 assert.match(observed,/sudo -n install -d -m 0700 -o user -g user -- '\/paperclip-workspace'/);
 assert.match(observed,/\[ ! -w '\/paperclip-workspace' \]/);
 assert.doesNotMatch(observed,/chmod 777|chown -R/);
});
