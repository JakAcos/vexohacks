import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractGemini} from '../src/server/agents.js';

test('valid empty extraction preserves a report without inventing facts; malformed output still fails', async () => {
  const fetchBefore=globalThis.fetch, key=process.env.GEMINI_API_KEY, model=process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY='local-test-placeholder'; process.env.GEMINI_MODEL='local-test-model';
  let payload: unknown={facts:[]};
  globalThis.fetch=async()=>new Response(JSON.stringify({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(payload)}]}]}),{status:200});
  try {
    assert.deepEqual(await extractGemini('Copy that.', 'Test speaker'), []);
    payload={facts:[{topic:'invented'}]};
    await assert.rejects(()=>extractGemini('Copy that.', 'Test speaker'));
  } finally {
    globalThis.fetch=fetchBefore;
    if(key===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=key;
    if(model===undefined)delete process.env.GEMINI_MODEL;else process.env.GEMINI_MODEL=model;
  }
});
