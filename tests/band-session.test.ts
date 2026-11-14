import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BandSession} from '../src/server/band-session.js';
import {createApp} from '../src/server/app.js';

test('real app startup migrates legacy band metadata before incident recovery',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'relay-band-restart-'));
  const first=createApp({directory:folder,mode:'demo'});
  try {
    await first.ready;
    await first.store.record('fixture','Speaker','Smoke on second floor.','demo',async()=>[], 'typed');
    await first.store.close();
    writeFileSync(join(folder,'band-session-state.json'),JSON.stringify({status:'stopped',bandNumber:38,
      receivedPackets:500,queuedReports:1,acknowledgedReports:1,pendingReports:0,silenceSegments:0,
      incidentId:'fixture',speaker:'Speaker'}));
    const restarted=createApp({directory:folder,mode:'demo'});
    try{
      await restarted.ready;
      assert.equal((await restarted.store.get('fixture')).observations.length,1);
      assert.ok(existsSync(join(folder,'.band','session-state.json')));
      assert.equal(existsSync(join(folder,'band-session-state.json')),false);
    }finally{await restarted.store.close();}
  }finally{await first.store.close();rmSync(folder,{recursive:true,force:true});}
});

test('managed band session has one owner, exposes only metadata, survives silence and stops owned child',()=>{
  const previous={...process.env},folder=mkdtempSync(join(tmpdir(),'relay-band-test-'));
  process.env.VEXO_BAND_NUMBER='38';process.env.GEMINI_API_KEY='test-only';process.env.GEMINI_MODEL='test-only';
  const child=Object.assign(new EventEmitter(),{pid:12345,stdout:new PassThrough(),stderr:new PassThrough(),kill:(signal:string)=>{assert.equal(signal,'SIGTERM');return true;}});
  let starts=0;
  const launcher=((command:string,args:string[],options:any)=>{
    starts++;assert.ok(args.includes('continuous'));assert.ok(args.includes('--confirm-capture')||args.includes('--drain-only'));
    assert.equal(options.shell,false);assert.equal(options.env.VEXO_PARENT_PID,String(process.pid));
    return child;
  }) as unknown as typeof spawn;
  try{
    const session=new BandSession(folder,'gemini',launcher);
    assert.equal(session.start('fixture','Speaker').status,'connecting');
    assert.throws(()=>session.start('other','Speaker'),/already active/);assert.equal(starts,1);
    child.stdout.write(JSON.stringify({event:'microphone_capture_started',at:'2026-11-14T21:00:00Z'})+'\n');
    assert.equal(session.snapshot().status,'listening');
    session.observe({event:'audio_totals',packets:1000});
    session.observe({event:'turn_buffered',pending:1});
    session.observe({event:'turn_acknowledged',result:'silence',pending:0});
    assert.equal(session.snapshot().acknowledgedReports,0);assert.equal(session.snapshot().silenceSegments,1);
    session.observe({event:'turn_acknowledged',result:'queued',pending:0});
    assert.equal(session.snapshot().acknowledgedReports,1);
    session.observe({event:'band_reconnecting'});assert.equal(session.snapshot().status,'reconnecting');
    session.observe({event:'band_reconnected'});assert.equal(session.snapshot().status,'listening');
    assert.equal(session.stop().status,'stopping');child.emit('exit',0);
    assert.equal(session.snapshot().status,'stopped');assert.equal(session.snapshot().pid,undefined);
    session.start('fixture','Speaker');child.emit('error',new Error('private detail'));
    assert.equal(session.snapshot().status,'error');assert.doesNotMatch(session.snapshot().lastError!,/private detail/);
    session.start('fixture','Speaker');assert.equal(starts,3);session.stop();child.emit('exit',null);
    session.observe({event:'turn_buffered',pending:1});
    const restored=new BandSession(folder,'gemini',launcher);
    assert.equal(restored.snapshot().pendingReports,1);
    assert.throws(()=>restored.start('other','Speaker'),/Retry the saved/);
    assert.equal(restored.retry().status,'stopping');
    restored.observe({event:'turn_acknowledged',result:'queued',pending:0});
    child.emit('exit',0);assert.equal(restored.snapshot().status,'stopped');
  }finally{
    for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];
    Object.assign(process.env,previous);rmSync(folder,{recursive:true,force:true});
  }
});
