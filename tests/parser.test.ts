import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractDemo, isResidentResolution} from '../src/server/agents.js';
import {scenario} from '../src/shared/model.js';
const facts=(text:string,topic:string)=>extractDemo(text).filter(f=>f.topic===topic);

test('negated smoke clearance never resolves a hazard',()=>{
  for(const text of ['Smoke has not cleared.','Smoke hasn’t gone.','We cannot confirm there is no smoke.','Smoke has never cleared.']) {
    const result=facts(text,'smoke');assert.ok(result.length,text);assert.ok(result.every(f=>f.status!=='resolved'),text);
  }
});
test('uncertain or interrogative clearance remains unresolved',()=>{
  for(const [text,topic] of [['Smoke may have cleared.','smoke'],['Is there no smoke?','smoke'],['Rear entrance might be clear.','rear-entrance'],['Rear entrance is clear?','rear-entrance'],['We are not sure the rear entrance is clear.','rear-entrance']]) {
    const result=facts(text,topic);assert.ok(result.length,text);assert.ok(result.every(f=>f.status!=='resolved'&&f.uncertain),text);
  }
});
test('clearance applies only to its own clause and subject',()=>{
  for(const text of ['Rear entrance is blocked. The street is clear.','Rear entrance is blocked and the street is clear.','Rear entrance is blocked, but traffic is clear.','Rear entrance is blocked because the street is clear.']) assert.equal(facts(text,'rear-entrance')[0].status,'reported',text);
  const mixed=extractDemo('Smoke has not cleared, but the rear entrance is clear.');
  assert.equal(mixed.find(f=>f.topic==='smoke')?.status,'reported');
  assert.equal(mixed.find(f=>f.topic==='rear-entrance')?.status,'resolved');
});
test('explicit narrow clearances are recognized',()=>{
  for(const text of ['There is no smoke.','Smoke has cleared.','Smoke is no longer visible.']) assert.equal(facts(text,'smoke')[0].status,'resolved',text);
  for(const text of ['The rear entrance is clear.','Rear entrance is not blocked.','The rear entrance is no longer blocked.','Rear entrance is unblocked.']) assert.equal(facts(text,'rear-entrance')[0].status,'resolved',text);
  assert.equal(facts('The rear entrance is not clear.','rear-entrance')[0].status,'reported');
});
test('opposite statements remain conflicting in either order',()=>{
  for(const text of ['There is no smoke. Smoke is visible on the second floor.','Smoke is visible but there is no smoke.','The rear entrance is clear, but the rear entrance remains blocked.']) {
    const result=extractDemo(text);assert.ok(result.length>=2);assert.ok(result.every(f=>f.status==='contradiction'),text);
  }
});
test('resident attribution remains attached to its clauses',()=>{
  const result=extractDemo('A resident reports smoke and the rear entrance is blocked. We see smoke on the second floor.');
  assert.deepEqual(result.map(f=>f.source),['resident','resident','speaker']);
  assert.equal(extractDemo(scenario[0].text)[0].source,'speaker');
});
test('only an explicit certain resident correction closes occupant concern',()=>{
  assert.ok(isResidentResolution(scenario[2].text));
  for(const prefix of ['The resident has not located the missing person outside.','The resident may have located the missing person outside.','The resident found the person’s wallet outside.','The resident found the person outside?']) assert.equal(isResidentResolution(prefix+' The resident reports nobody else is missing.'),false,prefix);
  assert.equal(isResidentResolution('The resident found the person outside. The resident reports nobody else is missing except one child.'),false);
  assert.equal(isResidentResolution(scenario[2].text+' The resident reports someone is still upstairs.'),false);
});
test('unknown and smoke-detector reports are preserved for review',()=>{
  for(const text of ['Copy that.','There is no smoke detector.']) assert.equal(extractDemo(text)[0].topic,'other');
});
