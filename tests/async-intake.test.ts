import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Store } from "../src/server/store.js";
import { createApp } from "../src/server/app.js";
import { extractDemo } from "../src/server/agents.js";
import { demoPlan } from "../src/server/orchestrator.js";
import type { Incident } from "../src/shared/model.js";
const gate = () => { let release!: () => void; const promise = new Promise<void>(r => release = r); return {promise, release}; };
const timely = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, reject) => {const timer=setTimeout(()=>reject(Error("mission blocked behind provider")),1000);timer.unref();})]);
const directory = () => mkdtemp(join(tmpdir(), "relay-async-"));

test("HTTP acknowledges durable reports, accepts other reports and streams while extraction is blocked", async () => {
  const dir = await directory(), extraction = gate(), entered = gate();
  const {app,store} = createApp({directory:dir,processing:{extract:async text=>{entered.release();await extraction.promise;return extractDemo(text);}}});
  const server=app.listen(0,"127.0.0.1"); await new Promise<void>(r=>server.once("listening",r));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const post=(path:string,body:unknown)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const streamAbort=new AbortController();
  try {
    const event=randomUUID(),body={incidentId:"mission",speaker:"A",text:"Smoke reported. Request an ambulance.",clientEventId:event};
    const accepted=await timely(post("/observations",body));assert.equal(accepted.status,202);
    const initial=await accepted.json() as Incident;assert.equal(initial.observations[0].text,body.text);assert.equal(initial.observations[0].factsReady,false);
    await entered.promise;
    assert.equal((await new Store(dir).get("mission")).observations.length,1);
    const second=await timely(post("/observations",{...body,speaker:"B",text:"Rear entrance blocked.",clientEventId:randomUUID()}));assert.equal(second.status,202);
    assert.equal((await new Store(dir).get("mission")).observations.length,2);
    const stream=await timely(fetch(base+"/incidents/mission/events",{signal:streamAbort.signal}));
    const reader=stream.body!.getReader();const bytes=await timely(reader.read());assert.match(new TextDecoder().decode(bytes.value),/Rear entrance blocked/);
    await reader.cancel();
    assert.equal((await timely(post("/briefings",{incidentId:"mission"}))).status,200);
    assert.equal((await timely(post("/observations",body))).status,202);
    assert.equal((await store.get("mission")).observations.length,2);
    extraction.release();await store.idle();
    const state=await store.get("mission");assert.equal(state.reportJobs?.filter(j=>j.status==="complete").length,2);
    const ems=state.actions.find(a=>a.service==="ems")!;assert.equal(ems.status,"proposed");
    const approve=()=>post(`/actions/${ems.id}/approve`,{incidentId:"mission",approvedBy:"Dispatcher",expectedVersion:state.version});
    const receipts=await Promise.all([approve(),approve()]);assert.ok(receipts.every(r=>r.status===200));
    const persisted=await new Store(dir).get("mission");assert.equal(persisted.agentEvents.filter(e=>e.agent==="service"&&e.actionId===ems.id).length,1);
    assert.equal(persisted.actions.find(a=>a.id===ems.id)?.receipt?.simulated,true);
  } finally { extraction.release();streamAbort.abort();await store.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true}); }
});

test("extraction and planning failures retain reports and retry without duplicate facts or deliveries",async()=>{
  const dir=await directory();let extractionFails=true,planningFails=true;
  const store=new Store(dir,{extract:async text=>{if(extractionFails)throw Error("extraction unavailable");return extractDemo(text);},plan:async(_,o)=>{if(planningFails)throw Error("planner unavailable");return demoPlan(o);}});
  try {
    const state=await store.acceptRecord("m","A","Smoke reported. Request an ambulance.","demo","typed",randomUUID());
    const jobId=state.reportJobs![0].id;await store.idle();
    let saved=await new Store(dir).get("m");assert.equal(saved.observations.length,1);assert.equal(saved.reportJobs![0].status,"failed");assert.equal(saved.issues.length,0);
    extractionFails=false;await store.retryReport("m",jobId);await store.idle();saved=await store.get("m");assert.equal(saved.reportJobs![0].status,"failed");assert.equal(saved.observations[0].factsReady,true);assert.equal(saved.actions.length,0);
    planningFails=false;await store.retryReport("m",jobId);await store.idle();saved=await store.get("m");assert.equal(saved.reportJobs![0].status,"complete");assert.equal(saved.issues[0].evidence.length,1);assert.equal(saved.actions.length,2);
    await store.retryReport("m",jobId);await store.idle();assert.equal((await store.get("m")).actions.length,2);
  } finally {await store.close();await rm(dir,{recursive:true,force:true});}
});

test("late plans are re-evaluated against new reports and cannot resurrect a reset mission",async()=>{
  const dir=await directory(), planning=gate(), entered=gate();let first=true,replans=0;
  const store=new Store(dir,{plan:async(state,o)=>{if(first){first=false;entered.release();await planning.promise;}replans++;return state.observations.some(x=>/cancel/i.test(x.text))?[]:demoPlan(o);}});
  try {
    await store.acceptRecord("m","A","Request an ambulance.","demo");await entered.promise;
    await timely(store.acceptRecord("m","B","Cancel the ambulance request.","demo"));
    planning.release();await store.idle();assert.equal((await store.get("m")).actions.length,0);assert.ok(replans>=2);
    const pause=gate(), started=gate();const resetting=new Store(dir,{extract:async text=>{started.release();await pause.promise;return extractDemo(text);}});
    await resetting.acceptRecord("reset","A","Request an ambulance.","demo");await started.promise;
    await timely(resetting.reset("reset"));pause.release();await resetting.idle();assert.equal((await resetting.get("reset")).observations.length,0);assert.equal((await resetting.get("reset")).actions.length,0);await resetting.close();
  } finally {planning.release();await store.close();await rm(dir,{recursive:true,force:true});}
});

test("audio is durable before transcription, failed transcription retries saved bytes and rejects changed content IDs",async()=>{
  const dir=await directory(), transcription=gate(), entered=gate();let fail=true;
  const store=new Store(dir,{transcribe:async bytes=>{assert.equal(bytes.toString(),"test audio bytes");entered.release();await transcription.promise;if(fail)throw Error("speech unavailable");return "Smoke reported. Request an ambulance.";}});
  try {
    const event=randomUUID(),data=Buffer.from("test audio bytes");
    const accepted=await timely(store.acceptAudio("m","A",data,"audio/wav","gemini","demo",event));await entered.promise;
    const files=await readdir(dir);assert.ok(files.some(p=>p.endsWith(".audio")));
    assert.equal((await new Store(dir).get("m")).reportJobs![0].status,"transcribing");
    await assert.rejects(store.acceptAudio("m","A",Buffer.from("changed"),"audio/wav","gemini","demo",event),/different content/);
    await timely(store.acceptRecord("m","B","Rear entrance blocked.","demo"));
    transcription.release();await store.idle();assert.equal((await store.get("m")).reportJobs![0].status,"failed");
    fail=false;await store.retryReport("m",accepted.jobId);await store.idle();
    const state=await store.get("m");assert.equal(state.reportJobs![0].status,"complete");assert.equal(state.observations.filter(o=>o.clientEventId===event).length,1);
    await store.acceptAudio("m","A",data,"audio/wav","gemini","demo",event);await store.idle();assert.equal((await store.get("m")).observations.length,2);
    assert.equal((await readdir(dir)).filter(p=>p.endsWith(".audio")).length,0);
  } finally {transcription.release();await store.close();await rm(dir,{recursive:true,force:true});}
});

test("a restarted worker resumes the durable in-progress snapshot and publishes its result",async()=>{
  const source=await directory(),restart=await directory(),blocked=gate(),entered=gate();
  const before=new Store(source,{extract:async text=>{entered.release();await blocked.promise;return extractDemo(text);}});
  try {
    await before.acceptRecord("m","A","Smoke reported. Request an ambulance.","demo","typed",randomUUID());await entered.promise;
    // Copy only durable files, exactly the state available after a process crash. The old
    // worker stays on a different directory and cannot contribute to the recovered result.
    await cp(source,restart,{recursive:true});let published=0;
    const after=new Store(restart,{onChange:()=>published++});await after.resume();await after.idle();
    const state=await after.get("m");assert.equal(state.observations.length,1);assert.equal(state.reportJobs![0].status,"complete");assert.equal(state.actions.length,2);assert.ok(published>=2);
    await after.resume();await after.idle();assert.equal((await after.get("m")).actions.length,2);await after.close();
  } finally {blocked.release();await before.close();await rm(source,{recursive:true,force:true});await rm(restart,{recursive:true,force:true});}
});

test("out-of-order extraction preserves received evidence order and pending reports remain in briefings",async()=>{
  const dir=await directory(),slow=gate(),entered=gate();
  const store=new Store(dir,{extract:async text=>{if(text.includes("Smoke")){entered.release();await slow.promise;}return extractDemo(text);}});
  try {
    await store.acceptRecord("m","A","Smoke reported.","demo");await entered.promise;
    await store.acceptRecord("m","B","No smoke on the second floor.","demo");
    const briefing=await timely(store.briefing("m"));assert.match(briefing.briefings[0].text,/Unprocessed report from A/);
    slow.release();await store.idle();const state=await store.get("m");assert.equal(state.issues[0].status,"conflicting");assert.deepEqual(state.issues[0].evidence.map(e=>e.source),["A","B"]);
  }finally{slow.release();await store.close();await rm(dir,{recursive:true,force:true});}
});

test("continuous band silence completes durably without a report, and the next spoken segment retains source and capture mode",async()=>{
  const dir=await directory();
  const source={kind:"vexo" as const,bandNumber:38,transport:"ble" as const,capturedAt:new Date().toISOString()};
  const store=new Store(dir,{transcribe:async(bytes,_type,_provider,allowSilence)=>{assert.equal(allowSilence,true);return bytes.toString()==="silence"?"":"Smoke reported. Request an ambulance.";}});
  try {
    const silent=await store.acceptAudio("m","Band responder",Buffer.from("silence"),"audio/wav","gemini","demo",randomUUID(),"vexo-audio",source,"continuous");
    await store.idle();let state=await new Store(dir).get("m");
    assert.equal(state.observations.length,0);assert.equal(state.reportJobs![0].status,"complete");assert.equal(state.reportJobs![0].result,"silence");assert.equal(state.reportJobs![0].captureMode,"continuous");
    const spoken=await store.acceptAudio("m","Band responder",Buffer.from("speech"),"audio/wav","gemini","demo",randomUUID(),"vexo-audio",source,"continuous");
    assert.notEqual(spoken.jobId,silent.jobId);await store.idle();state=await new Store(dir).get("m");assert.equal(state.observations.length,1);assert.deepEqual(state.observations[0].sourceDevice,source);assert.equal(state.observations[0].inputKind,"vexo-audio");assert.equal(state.reportJobs![1].status,"complete");assert.equal(state.actions.length,2);
  }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test("two audio jobs finishing out of order retain receive order and startup repairs older misordered snapshots",async()=>{
  const dir=await directory(),first=gate(),entered=gate(), plannedOrders: string[][] = [];
  const store=new Store(dir,{transcribe:async bytes=>{if(bytes.toString()==="first"){entered.release();await first.promise;return "Smoke reported. A resident reports someone may still be upstairs.";}return "No smoke on the second floor. The resident has located the missing person outside. The resident reports nobody else is missing.";},plan:async(state,observation)=>{plannedOrders.push(state.observations.map(o=>o.speaker));return demoPlan(observation);}});
  try {
    await store.mutate("m",state=>{
      for(const speaker of ["Legacy one","Legacy two"])state.observations.push({id:randomUUID(),speaker,text:"Original legacy report",facts:[],factsReady:true,mode:"demo",inputKind:"typed",timestamp:new Date().toISOString(),processingMs:0});
    });
    await store.acceptAudio("m","First",Buffer.from("first"),"audio/wav","gemini","demo",randomUUID());await entered.promise;
    await store.acceptAudio("m","Second",Buffer.from("second"),"audio/wav","gemini","demo",randomUUID());
    for(let n=0;n<100;n++){if((await store.get("m")).observations.some(o=>o.speaker==="Second"))break;await new Promise(r=>setTimeout(r,10));}
    assert.ok((await store.get("m")).observations.some(o=>o.speaker==="Second"));
    first.release();await store.idle();let state=await store.get("m");
    assert.deepEqual(state.observations.map(o=>o.speaker),["Legacy one","Legacy two","First","Second"]);
    assert.deepEqual(state.issues.find(i=>i.topic==="smoke")!.evidence.map(e=>e.source),["First","Second"]);
    assert.equal(state.issues.find(i=>i.id==="occupant-resident")!.status,"resolved", "late older extraction must not override the newer resident correction");
    const completeContexts=plannedOrders.filter(order=>order.includes("First")&&order.includes("Second"));
    assert.ok(completeContexts.length>0);assert.ok(completeContexts.every(order=>order.indexOf("First")<order.indexOf("Second")));
    const ids=state.observations.map(o=>o.id),receipts=JSON.stringify(state.actions),version=state.version;
    await store.mutate("m",s=>{s.observations=[s.observations[3],s.observations[2],s.observations[0],s.observations[1]];});
    const recovered=new Store(dir);await recovered.resume();await recovered.idle();state=await recovered.get("m");
    assert.deepEqual(state.observations.map(o=>o.id),ids);assert.equal(JSON.stringify(state.actions),receipts);assert.ok(state.version>version);
    const revision=state.revision;await recovered.resume();assert.equal((await recovered.get("m")).revision,revision);await recovered.close();
  }finally{first.release();await store.close();await rm(dir,{recursive:true,force:true});}
});
