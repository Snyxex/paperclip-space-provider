import test from 'node:test';
import assert from 'node:assert/strict';
import {SpaceClient} from '../src/space-client.js';

const settings = {
  apiToken:'unit-test-token',
  apiUrl:'http://172.20.0.1:18080',
  dataPlaneUrl:'http://172.20.0.1:18090',
  allowInsecurePrivateHttp:true,
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json'},
});
const stream=(events)=>new Response(events,{
  status:200,headers:{'content-type':'text/event-stream'},
});
const incomplete=()=>stream('data: {"type":"stdout","data_base64":"cGFydGlhbA=="}\n\n');
const completed=()=>stream('data: {"type":"stdout","data_base64":"b2s="}\n\n'
  + 'data: {"type":"process_exited","exit_code":0}\n\n');

function fixture({
  response=incomplete,
  processStates=[{}, {state:'exited'}],
  killStatus=200,
  attach=null,
  missingProcessId=false,
}={}) {
  const calls=[];
  let inspect=0;
  const client=new SpaceClient(settings,async(url,opts)=>{
    const path=new URL(url).pathname;
    calls.push({path,method:opts.method,authorization:opts.headers.Authorization,body:opts.body});
    if(path==='/v1/sandboxes/sbx_test/commands') return json({
      session_id:'proc_session',
      ...(missingProcessId?{}:{process_id:'proc_command'}),
      attach:attach??{events_url:'/v1/sessions/proc_session/events',token:'attachment-token'},
    });
    if(path==='/v1/sessions/proc_session/events')
      return response instanceof Function ? response() : response;
    if(path==='/v1/sandboxes/sbx_test/processes/proc_command' && opts.method==='GET') {
      const state=processStates[Math.min(inspect++,processStates.length-1)];
      if (state===null) return json({error:'not found'},404);
      return json({process_id:'proc_command',...state});
    }
    if(path==='/v1/sandboxes/sbx_test/processes/proc_command:kill' && opts.method==='POST')
      return killStatus===200?json({ok:true}):json({error:'unknown'},killStatus);
    throw new Error('unexpected API call '+path);
  });
  return {client,calls};
}

test('a confirmed process exit is success without any process-inspection or kill',async()=>{
  const {client,calls}=fixture({response:completed});
  const result=await client.exec('sbx_test','printf',['ok']);
  assert.equal(result.exitCode,0);
  assert.equal(result.stdout,'ok');
  assert.equal(calls.filter(c=>c.path.endsWith(':kill')).length,0);
  assert.equal(calls.filter(c=>c.path.endsWith('/proc_command')).length,0);
});

test('stream loss triggers one targeted process kill and separate exit verification',async()=>{
  const {client,calls}=fixture();
  await assert.rejects(client.exec('sbx_test','sh',['-c','echo test']),err=>{
    assert.match(err.message,/process proc_command in sandbox sbx_test/);
    assert.match(err.message,/outcome uncertain; termination verified after one kill/);
    assert.doesNotMatch(err.message,/attachment-token|unit-test-token/);
    return true;
  });
  assert.equal(calls.filter(c=>c.path.endsWith('/commands')).length,1);
  const kills=calls.filter(c=>c.path.endsWith(':kill'));
  assert.equal(kills.length,1);
  assert.equal(kills[0].authorization,'Bearer unit-test-token');
  assert.equal(calls.find(c=>c.path.endsWith('/events')).authorization,'Bearer attachment-token');
});

test('an already-exited process after stream loss is still not a successful command',async()=>{
  const {client,calls}=fixture({processStates:[{state:'exited',exit_code:0}]});
  await assert.rejects(client.exec('sbx_test','sh',['-c','echo test']),/outcome uncertain; process already exited/);
  assert.equal(calls.filter(c=>c.path.endsWith(':kill')).length,0);
});

test('unknown kill outcome is never retried or reported as terminated',async()=>{
  const {client,calls}=fixture({processStates:[{}],killStatus:503});
  await assert.rejects(client.exec('sbx_test','sh',['-c','echo test']),/termination unconfirmed; inspect SPACE before retrying/);
  assert.equal(calls.filter(c=>c.path.endsWith(':kill')).length,1);
  assert.equal(calls.filter(c=>c.path.endsWith('/commands')).length,1);
});

test('a successful kill acknowledgement without process exit is unconfirmed',async()=>{
  const {client,calls}=fixture({processStates:[{}]});
  await assert.rejects(client.exec('sbx_test','sh',['-c','echo test']),/termination unconfirmed/);
  assert.equal(calls.filter(c=>c.path.endsWith(':kill')).length,1);
  assert.equal(calls.filter(c=>c.path.endsWith('/proc_command')).length,4);
});

test('missing process ID fails closed rather than guessing the session ID',async()=>{
  const {client,calls}=fixture({missingProcessId:true});
  await assert.rejects(client.exec('sbx_test','sh',['-c','echo test']),/without a valid process ID; cancellation cannot be verified/);
  assert.equal(calls.length,1);
});

test('unexpected attachment destination triggers kill without connecting to attacker endpoint',async()=>{
  const {client,calls}=fixture({attach:{events_url:'https://evil.example/events',token:'attachment-token'}});
  await assert.rejects(client.exec('sbx_test','sh',['-c','echo test']),/unexpected command stream destination/);
  assert.equal(calls.filter(c=>c.path.includes('/events')).length,0);
  assert.equal(calls.filter(c=>c.path.endsWith(':kill')).length,1);
});

test('404 during process lookup does not count as a confirmed exit',async()=>{
  const {client,calls}=fixture({processStates:[null]});
  await assert.rejects(client.exec('sbx_test','sh',['-c','echo test']),/termination unconfirmed/);
  assert.equal(calls.filter(c=>c.path.endsWith(':kill')).length,1);
});

test('stream transport exception is reconciled instead of automatically replaying command',async()=>{
  const {client,calls}=fixture({response:()=>{throw new Error('connection refused');}});
  await assert.rejects(client.exec('sbx_test','sh',['-c','echo test']),/termination verified after one kill/);
  assert.equal(calls.filter(c=>c.path.endsWith('/commands')).length,1);
  assert.equal(calls.filter(c=>c.path.endsWith(':kill')).length,1);
});

test('an incorrect process identity returned by SPACE must not prove termination',async()=>{
  const calls=[];
  const client=new SpaceClient(settings,async(url,opts)=>{
    const path=new URL(url).pathname;calls.push({path,method:opts.method});
    if(path.endsWith('/commands')) return json({
      session_id:'proc_session',process_id:'proc_command',
      attach:{events_url:'/v1/sessions/proc_session/events',token:'attachment-token'},
    });
    if(path.endsWith('/events'))return incomplete();
    if(path.endsWith('/proc_command'))return json({process_id:'proc_someone_else',state:'exited'});
    if(path.endsWith(':kill'))return json({ok:true});
    throw Error('unexpected request '+path);
  });
  await assert.rejects(client.exec('sbx_test','sh',['-c','true']),/termination unconfirmed/);
  assert.equal(calls.filter(c=>c.path.endsWith(':kill')).length,1);
});

test('a rejected streaming attachment attempts termination and never retries the command',async()=>{
  const {client,calls}=fixture({response:()=>new Response('',{status:401})});
  await assert.rejects(client.exec('sbx_test','sh',['-c','true']),/termination verified after one kill/);
  assert.equal(calls.filter(c=>c.path.endsWith('/commands')).length,1);
  assert.equal(calls.filter(c=>c.path.endsWith(':kill')).length,1);
});
