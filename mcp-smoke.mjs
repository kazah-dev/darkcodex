/** Optional live, read-only MCP check; requires the bridge and game client. */
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
const client=new Client({name:'bitburner-bridge-smoke',version:'0.1.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./mcp.mjs',import.meta.url))]});
try{
  await client.connect(transport);
  const {tools}=await client.listTools();
  if(tools.length!==7)throw Error('Unexpected tool count');
  const response=await client.callTool({name:'game_status',arguments:{}});
  if(response.isError)throw Error(response.content[0].text);
  const state=JSON.parse(response.content[0].text);
  console.log(JSON.stringify({tools:tools.length,hacking:state.hacking,servers:state.servers,processes:state.processes.length},null,2));
}finally{await client.close();}
