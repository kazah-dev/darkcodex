import {readFile} from 'node:fs/promises';
const {port,token}=JSON.parse(await readFile(new URL('./.local/connection.json',import.meta.url),'utf8'));
const response=await fetch(`http://127.0.0.1:${port}/install`,{method:'POST',headers:{Authorization:'Bearer '+token}});
const result=await response.json();if(!response.ok)throw Error(result.error);console.log(JSON.stringify(result,null,2));
