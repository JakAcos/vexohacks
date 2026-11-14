import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readdir,readFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import express from 'express';
import {createTestDesk} from '../src/server/test-desk.js';
import {createApp} from '../src/server/app.js';
import {createMissionTools,type MissionTools} from '../src/server/mission-tools.js';
import {type Proposal} from '../src/server/orchestrator.js';
import {MissionSource} from '../src/server/mission-source.js';
import type {Incident,Observation,ReportJob} from '../src/shared/model.js';
const proposal:Proposal={kind:'test_request',service:'test_desk',title:'Record staging supply need',detail:'Staging area Bravo needs drinking water.'};
const gate=()=>{let release!:()=>void;return {promise:new Promise<void>(r=>release=r),release:()=>release()};};
async function fixture(t:any,intercept?:express.RequestHandler){
 const directory=await mkdtemp(join(tmpdir(),'relay-mission-execution-')),desk=createTestDesk(join(directory,'desk'),{a:'a'.repeat(40),b:'b'.repeat(40)}),wrapper=express();if(intercept)wrapper.use(intercept);wrapper.use(desk.app);
 const server=wrapper.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const tools=createMissionTools({origin,aToken:'a'.repeat(40),bToken:'b'.repeat(40),timeoutMs:300});let decisions=0;
 tools.decide=async(state,action,receipt)=>{decisions++;assert.equal(action.testExecution!.ticket!.id,receipt.id);assert.ok(state.observations.length);return {sourceReceiptId:receipt.id,message:`Confirmed ticket ${receipt.id}; check the staging team's next update.`};};
 const relay=createApp({directory:join(directory,'relay'),mode:'gemini',missionTools:tools,processing:{extract:async()=>[],plan:async()=>[proposal]}});await relay.ready;
 t.after(async()=>{await relay.store.close();await relay.executor!.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(directory,{recursive:true,force:true});});
 return {directory,desk,tools,relay,decisions:()=>decisions};
}
async function settle(f:any){await f.relay.store.idle();await f.relay.executor.idle();return f.relay.store.get('mission') as Promise<Incident>;}
async function report(f:any,text='Staging Bravo needs drinking water.',event=randomUUID()){return f.relay.store.acceptRecord('mission','Team lead',text,'gemini','typed',event);}
async function entries(dir:string){return (await readdir(join(dir,'desk'))).filter(f=>f.endsWith('.json'));}

test('mission planner action executes real HTTP then receipt agent uses its confirmed result; retries and restart preserve receipts',async t=>{
 const f=await fixture(t);const accepted=await report(f);assert.equal(accepted.observations.length,1);assert.equal(accepted.actions.length,0);
 const s=await settle(f),[a,b]=s.actions;assert.equal(a.kind,'test_request');assert.equal(b.kind,'test_follow_up');assert.equal(a.status,'acknowledged');assert.equal(b.status,'acknowledged');assert.equal(b.testExecution!.sourceReceiptId,a.testExecution!.ticket!.id);assert.deepEqual(b.sourceObservationIds,[s.observations[0].id]);assert.equal(f.decisions(),1);assert.equal((await entries(f.directory)).length,2);
 assert.deepEqual(await f.desk.lookup(a.testExecution!.ticket!.id),a.testExecution!.ticket);
 assert.equal(a.testExecution!.ticket!.detail,proposal.detail);
 await f.relay.executor!.retry('mission',a.id);await f.relay.executor!.idle();assert.equal((await entries(f.directory)).length,2);
 const restored=createApp({directory:join(f.directory,'relay'),mode:'gemini',missionTools:f.tools});await restored.ready;await restored.executor!.idle();assert.deepEqual((await restored.store.get('mission')).actions,s.actions);await restored.store.close();await restored.executor!.close();
});
test('slow execution never blocks another report or briefing, and reset suppresses late downstream work',async t=>{
 const f=await fixture(t),pause=gate(),entered=gate();const original=f.tools.decide;f.tools.decide=async(...args)=>{entered.release();await pause.promise;return original(...args);};
 await report(f);await entered.promise;
 const second=await report(f,'Correction: no supplies are needed.');assert.equal(second.observations.length,2);await f.relay.store.briefing('mission');
 await f.relay.store.reset('mission');pause.release();await settle(f);assert.equal((await f.relay.store.get('mission')).actions.length,0);assert.equal((await entries(f.directory)).length,1);
});
test('lost destination ticket ACK blocks second agent until same-key retry recovers confirmed receipt',async t=>{
 let dropped=false;const f=await fixture(t,(req,res,next)=>{const send=res.json.bind(res);res.json=value=>{if(req.method==='POST'&&req.path==='/tickets'&&!dropped){dropped=true;req.socket.destroy();return res;}return send(value);};next();});
 await report(f);let s=await settle(f);assert.equal(s.actions[0].status,'failed');assert.equal(f.decisions(),0);assert.equal((await entries(f.directory)).length,1);
 await f.relay.executor!.retry('mission',s.actions[0].id);await f.relay.executor!.idle();s=await f.relay.store.get('mission');assert.equal(s.actions[0].status,'acknowledged');assert.equal((await entries(f.directory)).length,2);
});
test('lost downstream ACK retries the saved AI decision without another model call or duplicate receipt',async t=>{
 let dropped=false;const f=await fixture(t,(req,res,next)=>{const send=res.json.bind(res);res.json=value=>{if(req.method==='POST'&&req.path==='/mission-follow-ups'&&!dropped){dropped=true;req.socket.destroy();return res;}return send(value);};next();});
 await report(f);let s=await settle(f);assert.equal(s.actions[0].status,'failed');assert.equal(f.decisions(),1);assert.equal((await entries(f.directory)).length,2);const detail=s.actions[1].detail;
 await f.relay.executor!.retry('mission',s.actions[1].id);await f.relay.executor!.idle();s=await f.relay.store.get('mission');assert.equal(s.actions[1].detail,detail);assert.equal(s.actions[0].status,'acknowledged');assert.equal(f.decisions(),1);assert.equal((await entries(f.directory)).length,2);
});
test('receipt agent rejects invented receipt identity; no follow-up or false completion',async t=>{
 const f=await fixture(t);f.tools.decide=async()=>({sourceReceiptId:randomUUID(),message:'Invented confirmation'});await report(f);const s=await settle(f);assert.equal(s.actions[0].status,'failed');assert.ok(s.actions[0].testExecution!.ticket);assert.equal((await entries(f.directory)).length,1);assert.equal(s.actions.length,1);
});
test('receipt agent replans when mission changes while it reasons',async t=>{
 const f=await fixture(t),pause=gate(),entered=gate();let calls=0;f.tools.decide=async(state,_a,r)=>{calls++;if(calls===1){entered.release();await pause.promise;}return {sourceReceiptId:r.id,message:`Ticket ${r.id}; ${state.observations.at(-1)!.text}`};};
 await report(f);await entered.promise;await report(f,'Correction: cancel the supply request.');await f.relay.store.idle();pause.release();const s=await settle(f);assert.ok(calls>=2);assert.match(s.actions.find(a=>a.kind==='test_follow_up')!.detail,/cancel/);assert.equal((await entries(f.directory)).length,2);
});
test('disabled mission tools cannot execute injected test proposals',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'relay-disabled-mission-'));const relay=createApp({directory:dir,processing:{extract:async()=>[],plan:async()=>[proposal]}});await relay.ready;await relay.store.acceptRecord('mission','A','Supplies requested','gemini');await relay.store.idle();assert.equal((await relay.store.get('mission')).actions.length,0);await relay.store.close();await rm(dir,{recursive:true,force:true});
});

test('read-only source baselines history and pending audio, ignores wrong provenance, imports one fresh completed physical report once',async t=>{
 const f=await fixture(t);const initial=await f.relay.store.get('source');let snapshot:Incident={...initial,id:'source',reportJobs:[],observations:[]};
 const make=(status:ReportJob['status']='complete',band=38)=>{
  const id=randomUUID(),jobId=randomUUID(),device={kind:'vexo' as const,bandNumber:band,transport:'ble' as const,capturedAt:new Date().toISOString()};
  const obs:Observation={id,speaker:'Responder',text:'Staging needs water.',timestamp:new Date().toISOString(),mode:'gemini',inputKind:'vexo-audio',processingMs:20,processing:status,factsReady:status==='complete',facts:[{topic:'other',label:'Water needed',status:'reported',source:'speaker',uncertain:false}],sourceDevice:device};
  const job:ReportJob={id:jobId,speaker:obs.speaker,mode:'gemini',inputKind:'vexo-audio',sourceDevice:device,status,submittedAt:obs.timestamp,observationId:id,timings:{}};
  return {obs,job};
 };
 const old=make(),pending=make('transcribing');snapshot.observations=[old.obs];snapshot.reportJobs=[old.job,pending.job];delete pending.job.observationId;
 const app=express();app.get('/api/incidents/source',(_req,res)=>res.json(snapshot));const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const config={origin:`http://127.0.0.1:${(server.address() as any).port}`,sourceMission:'source',targetMission:'mission',bandNumber:38};
 const follower=new MissionSource(f.relay.store,join(f.directory,'relay'),config);await follower.tick();assert.equal(follower.snapshot().imported,0);
 pending.job.status='complete';pending.job.observationId=pending.obs.id;pending.obs.processing='complete';pending.obs.factsReady=true;const wrong=make('complete',39),typed=make();typed.obs.inputKind='typed';typed.job.inputKind='typed';const failed=make('failed');snapshot.observations.push(pending.obs,wrong.obs,typed.obs,failed.obs);snapshot.reportJobs.push(wrong.job,typed.job,failed.job);
 await follower.tick();assert.equal(follower.snapshot().imported,0);assert.equal((await f.relay.store.get('mission')).observations.length,0);
 const fresh=make();snapshot.observations.push(fresh.obs);snapshot.reportJobs.push(fresh.job);await follower.tick();await settle(f);await follower.tick();await settle(f);
 const state=await f.relay.store.get('mission');assert.equal(follower.snapshot().imported,1);assert.equal(state.observations.length,1);assert.equal(state.observations[0].clientEventId,fresh.obs.id);assert.deepEqual(state.observations[0].importedFrom,{missionId:'source',observationId:fresh.obs.id});assert.equal(state.issues.length,1);assert.equal((await entries(f.directory)).length,2);
 const restored=new MissionSource(f.relay.store,join(f.directory,'relay'),config);await restored.start();await restored.close();assert.equal(restored.snapshot().imported,1);assert.equal((await f.relay.store.get('mission')).observations.length,1);
 const changed=new MissionSource(f.relay.store,join(f.directory,'relay'),{...config,targetMission:'another'});await changed.tick();assert.equal(changed.snapshot().imported,0);assert.equal((await f.relay.store.get('another')).observations.length,0);
});

test('a newer mission version invalidates an unsubmitted queued action on restart',async t=>{
 const f=await fixture(t);await f.relay.executor!.close();
 await report(f);await f.relay.store.idle();let state=await f.relay.store.get('mission');assert.equal(state.actions[0].status,'queued');
 await f.relay.store.mutate('mission',s=>{s.version++;});
 const resumed=createApp({directory:join(f.directory,'relay'),mode:'gemini',missionTools:f.tools});await resumed.ready;await resumed.executor!.idle();
 state=await resumed.store.get('mission');assert.equal(state.actions[0].status,'dismissed');assert.equal(state.actions[0].testExecution!.ticket,undefined);assert.equal(f.decisions(),0);
 await resumed.store.close();await resumed.executor!.close();
});
test('a queued action and an in-progress follow-up recover with their original identities after restart',async t=>{
 const f=await fixture(t);await f.relay.executor!.close();await report(f);await f.relay.store.idle();const before=await f.relay.store.get('mission');
 const resumed=createApp({directory:join(f.directory,'relay'),mode:'gemini',missionTools:f.tools});await resumed.ready;await resumed.executor!.idle();let state=await resumed.store.get('mission');assert.equal(state.actions[0].id,before.actions[0].id);assert.equal(state.actions[0].status,'acknowledged');
 const receipt=state.actions[1].testExecution!.followUp!;
 // A process can die after the desk accepted a follow-up but before Relay saved the acknowledgment.
 await resumed.executor!.close();
 await resumed.store.mutate('mission',s=>{const [a,b]=s.actions;a.status='executing';a.testExecution!.phase='following_up';delete a.testExecution!.followUp;b.status='executing';b.testExecution!.phase='following_up';delete b.testExecution!.followUp;});
 await resumed.executor!.idle();await resumed.store.close();await resumed.executor!.close();
 const restarted=createApp({directory:join(f.directory,'relay'),mode:'gemini',missionTools:f.tools});await restarted.ready;await restarted.executor!.idle();state=await restarted.store.get('mission');assert.equal(state.actions[1].testExecution!.followUp!.id,receipt.id);assert.equal((await entries(f.directory)).length,2);assert.equal(f.decisions(),1);await restarted.store.close();await restarted.executor!.close();
});
test('a receipt missing selected request details cannot trigger the next agent',async t=>{
 const f=await fixture(t,(req,res,next)=>{const send=res.json.bind(res);res.json=value=>{if(req.method==='POST'&&req.path==='/tickets'){const copy={...value};delete copy.detail;return send(copy);}return send(value);};next();});
 await report(f);const state=await settle(f);assert.equal(state.actions[0].status,'failed');assert.equal(f.decisions(),0);assert.equal(state.actions.length,1);assert.equal((await entries(f.directory)).length,1);
});
