import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Uses fictional typed input. It never opens a microphone or contacts real services.
export async function runSmoke({ base, token, expectedMode = 'gemini' }) {
  const url = new URL(base);
  assert.ok(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)), 'Use HTTPS or loopback HTTP.');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Use an origin without credentials or a path.');
  assert.ok(token?.length >= 32, 'Provide RELAY_ACCESS_TOKEN through the environment.');
  base = url.origin;
  const incidentId = `stage-check-${randomUUID().slice(0, 8)}`;
  const headers = { Authorization: `Bearer ${token}` };
  const request = async (path, body, expectedStatus = 200) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(120000) });
    assert.equal(response.status, expectedStatus, `${path}: HTTP ${response.status}`);
    return response.json();
  };
  assert.equal((await fetch(base + '/api/health', { redirect: 'error', signal: AbortSignal.timeout(10000) })).status, 401, 'Private API must reject unauthenticated access.');
  const health = await request('/api/health');
  assert.equal(health.mode, expectedMode);
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/incidents/${incidentId}/events`, { headers, signal: controller.signal, redirect: 'error' });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const seen = [];
  let streamError;
  const streaming = (async () => {
    let pending = '';
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const event = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const data = event.split('\n').find(line => line.startsWith('data: '));
        if (data) seen.push(JSON.parse(data.slice(6)));
      }
    }
  })().catch(error => { if (!controller.signal.aborted) streamError = error; });
  const started = Date.now();
  try {
    const body = { incidentId, speaker: 'Stage rehearsal firefighter', inputKind: 'typed', clientEventId: randomUUID(),
      text: 'Smoke coming from the second floor. Request an ambulance for two injured people. Request police for traffic control. Share the smoke report with the mission team.' };
    const result = await request('/api/voice/turn', body, 202);
    const savedAckMs = Date.now() - started;
    let state = result.incident;
    assert.equal(state.observations.length, 1);
    assert.equal(state.observations[0].mode, expectedMode);
    const job = state.reportJobs?.find(j => j.clientEventId === body.clientEventId);
    assert.ok(job, 'Accepted response must include the durable report job');
    assert.equal(job.observationId, state.observations[0].id);
    assert.notEqual(job.status, 'complete', 'AI finished before durable acceptance was returned');
    const acceptedJobStatus = job.status;
    const savedView = await request(`/api/incidents/${incidentId}`);
    assert.ok(savedView.observations.some(o => o.clientEventId === body.clientEventId), 'Saved report unavailable while processing');
    const retryWhileProcessing = await request('/api/voice/turn', body, 202);
    assert.equal(retryWhileProcessing.incident.observations.length, 1);
    assert.equal(retryWhileProcessing.incident.reportJobs.filter(j => j.clientEventId === body.clientEventId).length, 1);
    const deadline = Date.now() + 120000;
    while (true) {
      if (streamError) throw streamError;
      state = await request(`/api/incidents/${incidentId}`);
      const current = state.reportJobs?.find(j => j.id === job.id);
      assert.ok(current, 'Durable report job disappeared');
      assert.notEqual(current.status, 'failed', 'Background report job failed; inspect the saved mission');
      if (current.status === 'complete') break;
      assert.ok(Date.now() < deadline, 'Background processing exceeded 120 seconds');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    for (const service of ['ems', 'police', 'team']) {
      const action = state.actions.find(a => a.service === service);
      assert.ok(action, `Missing ${service} action`);
      assert.ok(action.sourceObservationIds.includes(state.observations[0].id));
      assert.equal(action.status, service === 'team' ? 'acknowledged' : 'proposed');
    }
    const plannedMs = Date.now() - started;
    for (const action of state.actions.filter(a => a.kind === 'service_request')) {
      state = await request(`/api/actions/${action.id}/approve`, { incidentId, approvedBy: 'Automated fictional stage check', expectedVersion: state.version });
    }
    const repeated = await request('/api/voice/turn', body, 202);
    assert.equal(repeated.incident.observations.length, 1, 'Retry duplicated the report');
    assert.equal(repeated.incident.actions.length, state.actions.length, 'Retry duplicated actions');
    const remoteView = await request(`/api/incidents/${incidentId}`);
    assert.ok(remoteView.actions.every(a => a.status === 'acknowledged' && a.receipt?.simulated));
    // Give the independent event stream up to three seconds to catch up.
    for (let i = 0; i < 30 && !seen.some(s => s.actions.length >= 3 && s.actions.every(a => a.status === 'acknowledged')); i++)
      await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(seen.some(s => s.actions.length >= 3 && s.actions.every(a => a.status === 'acknowledged')), 'Second client did not receive final state');
    return { passed: true, incidentId, mode: health.mode, input: 'fictional typed report', physicalBandTested: false,
      backendLocation: url.protocol === 'https:' ? 'remote HTTPS; verify host deployment separately' : 'local loopback',
      observations: remoteView.observations.length, actions: remoteView.actions.map(a => ({ service: a.service, status: a.status, receiptId: a.receipt.id, simulated: a.receipt.simulated })),
      independentStreamSnapshots: seen.length, retryWithoutDuplicates: true, retryDuringProcessingWithoutDuplicates: true, savedAckMs, acceptedJobStatus, backgroundCompleteMs: plannedMs, totalMs: Date.now() - started };
  } finally { await reader.cancel().catch(() => {}); controller.abort(); await streaming; }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { console.log(JSON.stringify(await runSmoke({ base: process.env.COPILOT_URL, token: process.env.RELAY_ACCESS_TOKEN, expectedMode: process.env.EXPECTED_MODE ?? 'gemini' }), null, 2)); }
  catch (error) { console.error('Cloud acceptance check failed:', error.message); process.exitCode = 1; }
}
