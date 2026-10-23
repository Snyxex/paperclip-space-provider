import {StringDecoder} from 'node:string_decoder';
const MAX_FRAME = 1024*1024, MAX_CAPTURE=4*1024*1024;
export async function readCommandEvents(response, log=()=>{}) {
  if(!response.ok || !response.body) throw new Error('SPACE stream HTTP '+response.status);
  const reader=response.body.getReader(), decoder=new TextDecoder();
  const utf8={stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')};
  let buffer='', data=[], exited=false, exitCode=null, stdout='', stderr='';
  const append=(channel,value)=>{
    if(!value)return;
    log(channel,value);
    if(channel==='stdout') stdout=(stdout+value).slice(-MAX_CAPTURE);
    else stderr=(stderr+value).slice(-MAX_CAPTURE);
  };
  const frame=()=>{
    if(!data.length)return;
    let event;
    try{event=JSON.parse(data.join('\n'))}catch{throw new Error('SPACE returned invalid SSE JSON')}
    data=[];
    if(!event||typeof event!=='object'||Array.isArray(event))throw new Error('SPACE returned invalid SSE event');
    if(event.type==='error'||event.type==='resync_required')throw new Error('SPACE stream error; original command outcome is uncertain');
    if(event.type==='stdout'||event.type==='stderr'){
      if(typeof event.data_base64!=='string'||event.data_base64.length>MAX_FRAME||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.data_base64))
        throw new Error('Invalid base64 command output');
      append(event.type,utf8[event.type].write(Buffer.from(event.data_base64,'base64')));
    } else if(event.type==='process_exited'){
      if(!Number.isInteger(event.exit_code))throw new Error('SPACE exit event has no valid exit code');
      exitCode=event.exit_code; exited=true;
    }
  };
  try{
    for(;;){
      const {done,value}=await reader.read();
      buffer += done?decoder.decode():decoder.decode(value,{stream:true});
      if(buffer.length>MAX_FRAME*2)throw new Error('Oversized SPACE stream frame');
      while(buffer.includes('\n')){
        const n=buffer.indexOf('\n');
        let line=buffer.slice(0,n);
        buffer=buffer.slice(n+1);
        if(line.endsWith('\r'))line=line.slice(0,-1);
        if(!line){frame();continue;}
        if(line.startsWith('data:')){
          data.push(line.slice(5).replace(/^ /,''));
          if(data.join('\n').length>MAX_FRAME)throw new Error('Oversized SPACE SSE frame');
        }
      }
      if(done)break;
    }
    if(data.length||buffer.trim())throw new Error('SPACE stream ended with an incomplete event');
    if(!exited)throw new Error('SPACE stream ended without process_exited; command outcome uncertain');
    for(const channel of ['stdout','stderr'])append(channel,utf8[channel].end());
    return {exitCode,timedOut:false,stdout,stderr};
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
