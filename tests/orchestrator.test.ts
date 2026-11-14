import { settle } from "./settle.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Store } from "../src/server/store.js";
import { extractDemo } from "../src/server/agents.js";
import { demoPlan, coordinate } from "../src/server/orchestrator.js";
import { createApp } from "../src/server/app.js";
import type { Incident, Observation } from "../src/shared/model.js";

test("multiple responders share context, send one service request, and persist its acknowledgment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-actions-"));
  try {
    const store = new Store(directory);
    const record = (speaker: string, text: string, event?: string) => store.record("mission", speaker, text, "demo", async () => extractDemo(text), "transcript", event);
    const event = randomUUID();
    await Promise.all([
      record("Firefighter A", "Smoke coming from the second floor."),
      record("Police", "Request an ambulance for two injured people.", event),
    ]);
    let state = await store.get("mission");
    assert.equal(state.observations.length, 2);
    const action = state.actions.find(a => a.service === "ems")!;
    assert.equal(action.status, "proposed");
    assert.equal(state.actions.find(a => a.kind === "team_update")?.status, "acknowledged");
    await record("Police", "Request an ambulance for two injured people.", event);
    assert.equal((await store.get("mission")).observations.length, 2);
    await record("Dispatcher", "Request an ambulance for the same incident.");
    await assert.rejects(store.approveAction("mission", action.id, "Dispatcher", 2), /context changed/);
    state = await store.get("mission");
    assert.equal(state.actions.filter(a => a.service === "ems").length, 1);
    assert.equal(state.actions.find(a => a.id === action.id)?.sourceObservationIds.length, 2);
    await Promise.all([
      store.approveAction("mission", action.id, "Dispatcher", state.version),
      store.approveAction("mission", action.id, "Dispatcher", state.version),
    ]);
    const restored = await new Store(directory).get("mission");
    const receipt = restored.actions.find(a => a.id === action.id)?.receipt;
    assert.equal(receipt?.simulated, true);
    assert.match(receipt!.message, /No real units/);
    assert.equal(restored.agentEvents.filter(e => e.actionId === action.id && e.agent === "service").length, 1);
    assert.equal((await store.get("other-mission")).actions.length, 0);
    await assert.rejects(record("EMS", "different content", event), /different content/);
    assert.equal((await store.get("mission")).observations.length, 3);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test("negated and tentative resource mentions never create demo dispatch requests", () => {
  for (const text of ["We do not need an ambulance.", "No ambulance is needed.", "Maybe request an ambulance.", "Cancel the request for police.", "The police are here."]) {
    const observation = {id: randomUUID(), speaker: "A", text, facts: extractDemo(text)} as Observation;
    assert.equal(demoPlan(observation).filter(a => a.kind === "service_request").length, 0, text);
  }
});

test("old incident data is upgraded without losing reports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-migrate-"));
  try {
    await writeFile(join(directory, "old.json"), JSON.stringify({id:"old", observations:[{text:"original"}], version:1}));
    const state = await new Store(directory).get("old");
    assert.equal(state.observations[0].text, "original");
    assert.deepEqual(state.actions, []);
    assert.deepEqual(state.agentEvents, []);
  } finally { await rm(directory, {recursive:true, force:true}); }
});

test("HTTP action approval returns a real persisted simulator receipt and isolates missions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-action-http-"));
  const {app,store} = createApp({directory});
  const server = app.listen(0,"127.0.0.1");
  await new Promise<void>(r => server.once("listening",r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const post = (path:string,body:unknown) => fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(response=>settle(response,store));
  try {
    const body = {incidentId:"mission",speaker:"911 dispatcher",text:"Request police for traffic control.",clientEventId:randomUUID()};
    const response = await post("/voice/turn",body);
    assert.equal(response.status,202);
    const state = (await response.json()).incident as Incident;
    const action = state.actions[0];
    assert.equal(action.service,"police");
    assert.equal((await post(`/actions/${action.id}/approve`,{incidentId:"another",approvedBy:"Lead",expectedVersion:1})).status,404);
    const approved = await post(`/actions/${action.id}/approve`,{incidentId:"mission",approvedBy:"Lead",expectedVersion:state.version});
    assert.equal(approved.status,200);
    assert.equal((await approved.json()).actions[0].receipt.simulated,true);
    const duplicate = await post("/voice/turn",body);
    assert.equal((await duplicate.json()).incident.observations.length,1);
    const retry = await post(`/observations/${state.observations[0].id}/plan`,{incidentId:"mission"});
    assert.equal((await retry.json()).actions.length,1);
  } finally {
    await store.close();
    server.closeAllConnections();
    await new Promise<void>(r => server.close(()=>r()));
    await rm(directory,{recursive:true,force:true});
  }
});

test("Gemini planning has no silent fallback; retry executes only validated proposals", async () => {
  const directory = await mkdtemp(join(tmpdir(),"relay-planner-"));
  const oldFetch=globalThis.fetch, oldKey=process.env.GEMINI_API_KEY, oldModel=process.env.GEMINI_MODEL;
  try {
    process.env.GEMINI_API_KEY="test-only";process.env.GEMINI_MODEL="test-model";
    const state=await new Store(directory).get("mission");
    const observation={id:randomUUID(),speaker:"Firefighter",text:"Request an ambulance.",facts:[],timestamp:new Date().toISOString(),mode:"gemini",inputKind:"transcript",processingMs:0} as Observation;
    state.observations.push(observation);
    globalThis.fetch=async()=>new Response("unavailable",{status:503});
    await coordinate(state,observation,"gemini");
    assert.equal(state.actions.length,0);
    assert.match(state.agentEvents[0].message,/planning failed/);
    globalThis.fetch=async()=>new Response(JSON.stringify({status:"completed",steps:[{type:"model_output",content:[{type:"text",text:JSON.stringify({actions:[{kind:"service_request",service:"ems",title:"EMS support",detail:"Firefighter requests an ambulance."}]})}]}]}));
    await coordinate(state,observation,"gemini");
    await coordinate(state,observation,"gemini");
    assert.equal(state.actions.length,1);
    assert.equal(state.actions[0].status,"proposed");
  } finally {
    globalThis.fetch=oldFetch;
    if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey;
    if(oldModel===undefined)delete process.env.GEMINI_MODEL;else process.env.GEMINI_MODEL=oldModel;
    await rm(directory,{recursive:true,force:true});
  }
});

test("physical device provenance is scoped to assigned band and briefing retries are idempotent", async () => {
  const directory=await mkdtemp(join(tmpdir(),"relay-device-"));
  const oldBand=process.env.VEXO_BAND_NUMBER;
  process.env.VEXO_BAND_NUMBER="38";
  const {app,store}=createApp({directory});
  const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(r=>server.once("listening",r));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const post=(body:unknown)=>fetch(base+"/voice/turn",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(response=>settle(response,store));
  try {
    const body={incidentId:"band-mission",speaker:"Firefighter A",text:"Rear entrance is blocked.",inputKind:"vexo-transcript",clientEventId:randomUUID(),sourceDevice:{kind:"vexo",bandNumber:38,transport:"ble",capturedAt:new Date().toISOString()}};
    assert.equal((await post({...body,sourceDevice:{...body.sourceDevice,bandNumber:39}})).status,403);
    assert.equal((await post({...body,sourceDevice:undefined})).status,400);
    const response=await post(body);
    assert.equal(response.status,202);
    const state=(await response.json()).incident;
    assert.equal(state.observations[0].sourceDevice.bandNumber,38);
    assert.equal(state.observations[0].inputKind,"vexo-transcript");
    const command={...body,text:"Relay, give me the latest briefing.",clientEventId:randomUUID()};
    await post(command);
    const replay=await post(command);
    const repeated=(await replay.json()).incident;
    assert.equal(repeated.briefings.length,1);
    assert.equal(repeated.observations.length,1);
    assert.equal((await post({...command,text:"Smoke reported."})).status,409);
  } finally {
    if(oldBand===undefined)delete process.env.VEXO_BAND_NUMBER;else process.env.VEXO_BAND_NUMBER=oldBand;
    await store.close();
    server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r()));
    await rm(directory,{recursive:true,force:true});
  }
});
