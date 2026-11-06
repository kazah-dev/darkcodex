import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {readFile} from 'node:fs/promises';
import {tools,mutations,validate} from './tools.mjs';
const server=new Server({name:'darkcodex',version:'0.1.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:tools.map(t=>({...t,annotations:{readOnlyHint:!mutations.has(t.name),destructiveHint:mutations.has(t.name),openWorldHint:false}}))}));
server.setRequestHandler(CallToolRequestSchema,async({params})=>{
  try{
    validate(params.name,params.arguments);
    const {port,token}=JSON.parse(await readFile(new URL('./.local/connection.json',import.meta.url),'utf8'));
    const response=await fetch(`http://127.0.0.1:${port}/tool`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name:params.name,args:params.arguments}),signal:AbortSignal.timeout(200000)});
    const data=await response.json();if(!response.ok)throw Error(data.error);
    return {content:[{type:'text',text:JSON.stringify(data.result)}]};
  }catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
});
await server.connect(new StdioServerTransport());
