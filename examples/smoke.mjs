import {SpaceClient} from '../src/space-client.js';
// WARNING: this creates a real VM. Use disposable SPACE installations only.
if(!process.env.SPACE_API_TOKEN)throw new Error('SPACE_API_TOKEN is required');
const client=new SpaceClient({
 apiUrl:process.env.SPACE_API_URL,dataPlaneUrl:process.env.SPACE_DATA_PLANE_URL,
 allowInsecurePrivateHttp:process.env.SPACE_ALLOW_INSECURE_PRIVATE_HTTP==='true',
 apiToken:process.env.SPACE_API_TOKEN,template:process.env.SPACE_TEMPLATE??'seed:latest'
});
let id;
try{
 id=await client.create();console.log('Created',id);
 const r=await client.exec(id,'sh',['-c','printf space-provider-ready']);
 console.log('Exit:',r.exitCode,'Output:',r.stdout);
 if(r.exitCode!==0)process.exitCode=1;
}finally{if(id){await client.destroy(id);console.log('Deleted',id)}}
