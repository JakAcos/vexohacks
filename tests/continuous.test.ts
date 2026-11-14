import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudioSegments, encodeWav} from '../src/shared/continuous-audio.js';
import {isBriefingCommand} from '../src/shared/voice.js';
import {transcribeGemini,synthesizeGemini} from '../src/server/voice.js';

test('continuous PCM segmentation sends speech at pauses, skips silence and preserves final partial report',()=>{
 const output:Uint8Array[]=[]; const s=new AudioSegments(1000,b=>output.push(b));
 s.push(new Float32Array(12000));assert.equal(output.length,0);
 s.push(new Float32Array(1100).fill(.5));s.push(new Float32Array(900));assert.equal(output.length,1);
 const first=new DataView(output[0].buffer);assert.equal(first.getUint32(40,true),4000);assert.equal(first.getUint32(24,true),1000);
 s.push(new Float32Array(1500).fill(.25));s.flush();assert.equal(output.length,2);assert.equal(new DataView(output[1].buffer).getUint32(40,true),3000);
 s.flush();assert.equal(output.length,2);
});
test('continuous capture crosses repeated maximum segments without ending the session or losing PCM samples',()=>{
 const output:Uint8Array[]=[];const s=new AudioSegments(1000,b=>output.push(b));
 for(let i=0;i<50;i++)s.push(new Float32Array(500).fill(.2));s.flush();
 assert.equal(output.length,3);assert.equal(output.reduce((n,b)=>n+(b.length-44)/2,0),25000);
});
test('WAV clamps PCM and briefing commands are standalone, never embedded in reports',()=>{
 const bytes=encodeWav([new Float32Array([-2,0,2])],3,24000),v=new DataView(bytes.buffer);
 assert.equal(v.getInt16(44,true),-32768);assert.equal(v.getInt16(48,true),32767);
 for(const text of ['Relay, give me the latest briefing.','Update my briefing','Read the current briefing please'])assert.ok(isBriefingCommand(text));
 for(const text of ['The resident said give me the latest briefing.','Do not give me the latest briefing','Smoke coming from upstairs.'])assert.equal(isBriefingCommand(text),false);
});
test('Gemini audio contracts validate transcription and playable WAV; failed provider output is rejected',async()=>{
 const original=globalThis.fetch;const key=process.env.GEMINI_API_KEY,model=process.env.GEMINI_MODEL;
 process.env.GEMINI_API_KEY='contract-test';process.env.GEMINI_MODEL='test-model';
 try{
  let request:any;
  globalThis.fetch=async(_url,options)=>{request=JSON.parse(options!.body as string);return new Response(JSON.stringify({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'{"text":"Smoke has not cleared."}'}]}]}));};
  assert.equal(await transcribeGemini(Buffer.from([1,2,3]),'audio/wav'),'Smoke has not cleared.');
  assert.equal(request.input[1].data,'AQID');assert.equal(request.input[1].mime_type,'audio/wav');
  const wav=Buffer.from(encodeWav([new Float32Array(100).fill(.1)],100,24000));
  globalThis.fetch=async()=>new Response(JSON.stringify({status:'completed',steps:[{type:'model_output',content:[{type:'audio',data:wav.toString('base64'),mime_type:'audio/wav'}]}]}));
  assert.deepEqual(await synthesizeGemini('Smoke remains reported.'),wav);
  globalThis.fetch=async()=>new Response(JSON.stringify({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'{"text":""}'}]}]}));
  await assert.rejects(transcribeGemini(Buffer.from([1]),'audio/wav'),/No usable speech/);
  globalThis.fetch=async()=>new Response(JSON.stringify({status:'completed',steps:[{type:'model_output',content:[{type:'audio',data:Buffer.from('not audio').toString('base64')}]}]}));
  await assert.rejects(synthesizeGemini('Test'),/unsupported audio/);
 }finally{globalThis.fetch=original;if(key===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=key;if(model===undefined)delete process.env.GEMINI_MODEL;else process.env.GEMINI_MODEL=model;}
});
