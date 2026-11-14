import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/server/store.js';
import {demoPlan} from '../src/server/orchestrator.js';

test('four overlapping audio arrivals automatically replan the saved request without manual retry',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'relay-contention-'));let calls=0;
  const source={kind:'vexo' as const,bandNumber:38,transport:'ble' as const,capturedAt:new Date().toISOString()};
  const store=new Store(dir,{transcribe:async()=>'',plan:async(_state,o)=>{
    if(++calls<=4)await store.acceptAudio('m','Band',Buffer.from('silence'),'audio/wav','gemini','demo',randomUUID(),'vexo-audio',source,'continuous');
    return demoPlan(o);
  }});
  try{
    await store.acceptRecord('m','Responder','Smoke reported. Request an ambulance.','demo');
    await store.idle();const state=await store.get('m');
    assert.equal(state.reportJobs![0].status,'complete');assert.equal(calls,5);
    assert.ok(state.reportJobs!.every(j=>j.status==='complete'));
    assert.equal(state.observations.length,1);assert.equal(state.actions.length,2);
    assert.ok(state.actions.every(a=>a.sourceObservationIds.includes(state.observations[0].id)));
  }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test('one mission serializes planners while another mission and new intake remain responsive',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'relay-plan-order-'));let active=0,peak=0;
  let release!:()=>void,entered!:()=>void;const blocked=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
  let first=true;
  const store=new Store(dir,{plan:async(state,o)=>{
    if(state.id==='other')return [];
    active++;peak=Math.max(peak,active);
    try{if(first){first=false;entered();await blocked;}return demoPlan(o);}finally{active--;}
  }});
  try{
    await store.acceptRecord('m','A','Smoke reported.','demo');await started;
    await store.acceptRecord('m','B','Rear entrance blocked.','demo');
    await store.acceptRecord('other','C','Clear.','demo');
    for(let n=0;n<100;n++){if((await store.get('other')).reportJobs![0].status==='complete')break;await new Promise(r=>setTimeout(r,5));}
    assert.equal((await store.get('other')).reportJobs![0].status,'complete');
    release();await store.idle();assert.equal(peak,1);
    assert.ok((await store.get('m')).reportJobs!.every(j=>j.status==='complete'));
  }finally{release();await store.close();await rm(dir,{recursive:true,force:true});}
});
