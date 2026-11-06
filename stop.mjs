import {readFile} from 'node:fs/promises';
const {port,token}=JSON.parse(await readFile(new URL('./.local/connection.json',import.meta.url),'utf8'));
const response=await fetch(`http://127.0.0.1:${port}/shutdown`,{method:'POST',headers:{Authorization:'Bearer '+token}});
if(!response.ok)throw Error('Could not stop the local bridge');console.log('Bridge stopped. Existing game automation is unchanged.');
