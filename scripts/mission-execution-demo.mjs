import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {parse} from 'dotenv';
const root=resolve(import.meta.dirname,'..'),data=resolve(process.env.RELAY_MISSION_DEMO_DIR??resolve(root,'.mission-execution-demo'));
const port=Number(process.env.RELAY_MISSION_DEMO_PORT??14417),deskPort=Number(process.env.TEST_DESK_PORT??14418);
if(port===deskPort||![port,deskPort].every(p=>Number.isInteger(p)&&p>1024&&p<65536))throw Error('Choose two distinct local ports.');
for(const p of [port,deskPort])await new Promise((done,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(p,'127.0.0.1',()=>probe.close(done));});
const provider=process.env.RELAY_GEMINI_ENV_FILE?parse(await readFile(process.env.RELAY_GEMINI_ENV_FILE)):process.env;
if(!provider.GEMINI_API_KEY||!provider.GEMINI_MODEL)throw Error('Configure Gemini before launching mission execution.');
await mkdir(data,{recursive:true,mode:0o700});const credentialPath=resolve(data,'worker-credentials.json');let credentials;
try{credentials=JSON.parse(await readFile(credentialPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;credentials={a:randomBytes(32).toString('hex'),b:randomBytes(32).toString('hex')};await writeFile(credentialPath,JSON.stringify(credentials),{mode:0o600,flag:'wx'});}
const env={...process.env,AGENT_MODE:'gemini',HOST:'127.0.0.1',PORT:String(port),TEST_DESK_PORT:String(deskPort),DATA_DIR:resolve(data,'relay'),TEST_DESK_DATA_DIR:resolve(data,'desk'),GEMINI_API_KEY:provider.GEMINI_API_KEY,GEMINI_MODEL:provider.GEMINI_MODEL,RELAY_TEST_DESK_ORIGIN:`http://127.0.0.1:${deskPort}`,RELAY_TEST_DISPATCH_A_TOKEN:credentials.a,RELAY_TEST_DISPATCH_B_TOKEN:credentials.b,RELAY_MISSION_TEST_EXECUTION:'1',VEXO_BAND_NUMBER:'',DEEPGRAM_API_KEY:'',MINIMAX_API_KEY:'',PUBLIC_ORIGIN:'',RELAY_ACCESS_TOKEN:'',DOTENV_CONFIG_PATH:resolve(data,'unused.env')};
const children=[];let stopped=false;function stop(){if(stopped)return;stopped=true;for(const child of children)child.kill('SIGTERM');}
for(const entry of ['test-desk-main.js','index.js']){const child=spawn(process.execPath,[resolve(root,'build-server/server',entry)],{cwd:root,env,stdio:'inherit'});children.push(child);child.on('error',()=>{process.exitCode=1;stop();});child.on('exit',code=>{if(!stopped){process.exitCode=code||1;stop();}});}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
console.log(`Mission AI test execution: http://127.0.0.1:${port}/?incidentId=${process.env.RELAY_MISSION_TARGET_ID??'mission-ai-demo'}`);
console.log('Only this isolated Relay and test desk are owned by this launcher. Existing mission and band controls remain untouched.');
