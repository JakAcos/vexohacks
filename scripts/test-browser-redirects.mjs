// Opt-in real-browser security acceptance. Uses only the explicitly allocated agent session.
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {browserTicketExecutor} from '../build-server/server/browser-ticket.js';
import {createTestDesk} from '../build-server/server/test-desk.js';
const agentId=process.env.CODEX_THREAD_ID;
assert.ok(agentId,'CODEX_THREAD_ID must identify this runner\'s owned browser');
const modulePath=process.env.RELAY_PLAYWRIGHT_MODULE ?? 'playwright-core';
const directory=await mkdtemp(join(tmpdir(),'relay-browser-redirect-test-'));
const tokens={a:randomBytes(32).toString('hex'),b:randomBytes(32).toString('hex')};
const hits=[];let mode='success',authorizedSubmissions=0;
async function listen(app){const server=app.listen(0,'127.0.0.1');await once(server,'listening');return {server,origin:`http://127.0.0.1:${server.address().port}`};}
async function close(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
const sink=await listen(express().use((req,res)=>{hits.push({authorizationPresent:Boolean(req.get('authorization')),method:req.method});res.json({unexpected:true});}));
const desk=createTestDesk(join(directory,'desk'),tokens),sourceApp=express();
sourceApp.use((req,res,next)=>{
 if(req.method==='POST'&&req.path==='/tickets'){
  assert.equal(req.get('authorization'),`Bearer ${tokens.a}`);authorizedSubmissions++;
  if(mode==='external-307')return res.redirect(307,sink.origin+'/leak');
  if(mode==='external-302')return res.redirect(302,sink.origin+'/leak');
  if(mode==='same-origin-307')return res.redirect(307,'/leak');
 }
 if(req.path==='/leak'){hits.push({sameOrigin:true,authorizationPresent:Boolean(req.get('authorization'))});return res.json({unexpected:true});}
 next();
});sourceApp.use(desk.app);const source=await listen(sourceApp);
let observer;const checks=[];
try{
 await promisify(execFile)(join(homedir(),'Desktop/tools/agent-pov-monitor/agent-session'),['allocate',agentId],{timeout:90000});
 const registry=JSON.parse(await readFile(join(homedir(),'.codex/agent-pov-monitor/sessions.json'),'utf8'));
 const owned=registry.sessions[agentId];assert.equal(owned.ownership,'agent');assert.equal(owned.status,'ready');
 const {chromium}=await import(modulePath);observer=await chromium.connectOverCDP(`http://127.0.0.1:${owned.debug_port}`);
 const originalPages=observer.contexts()[0].pages().length;
 const execute=browserTicketExecutor({origin:source.origin,aToken:tokens.a,agentId,directory:join(directory,'evidence'),modulePath});
 for(const scenario of ['success','external-307','external-302','same-origin-307']){
  mode=scenario;const input={runId:randomUUID(),missionId:'redirect-acceptance',title:`Synthetic ${scenario} submission`};
  if(scenario==='success'){
   const result=await execute(input);assert.equal(result.receipt.title,input.title);assert.deepEqual(await desk.lookup(result.receipt.id),result.receipt);assert.equal(result.evidence.receiptId,result.receipt.id);
  }else{
   await assert.rejects(execute(input),/HTTP 502/);
   await assert.rejects(access(join(directory,'evidence',input.missionId,input.runId,'evidence.json')));
  }
  assert.equal(hits.length,0,'No redirected destination may receive any request or credentials');
  assert.equal(observer.contexts()[0].pages().length,originalPages,'Worker page must close');
  checks.push({scenario,passed:true});
 }
 // Force a setup failure after connection/page/route creation, before navigation.
 const blocked=join(directory,'not-a-directory');await writeFile(blocked,'file');
 const broken=browserTicketExecutor({origin:source.origin,aToken:tokens.a,agentId,directory:blocked,modulePath});
 await assert.rejects(broken({runId:randomUUID(),missionId:'cleanup',title:'Setup failure'}),/ENOTDIR/);
 assert.equal(observer.contexts()[0].pages().length,originalPages);
 checks.push({scenario:'setup-failure-closes-owned-page',passed:true});
 assert.equal(authorizedSubmissions,4);
 const result={checks,authorizedBrowserSubmissions:authorizedSubmissions,redirectDestinationRequests:hits.length,credentialsLeaked:false,originalOwnedPageCountPreserved:true};
 await writeFile(join(directory,'verification.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({verificationPath:join(directory,'verification.json'),...result},null,2));
}finally{await observer?.close();await close(source.server);await close(sink.server);}
