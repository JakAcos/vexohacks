import React, { useState } from "react";
import type { Incident, MissionAction } from "../shared/model";

type Props = {
  incident?: Incident;
  busy: boolean;
  connected: boolean;
  act: (label: string, path: string, body: unknown) => Promise<boolean>;
};
const services = { ems: "EMS", fire: "Fire", police: "Police", team: "Mission team", test_desk:"Test desk" };
const stamp = (value: string) => new Date(value).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"});

export function MissionActions({incident, busy, connected, act}: Props) {
  const [reviewer, setReviewer] = useState("Demo dispatcher");
  const [pendingId, setPendingId] = useState("");
  const [notice, setNotice] = useState("");
  const [retryReport, setRetryReport] = useState("");
  const actions = incident?.actions ?? [];
  const events = incident?.agentEvents ?? [];
  const waiting = actions.filter(a => a.status === "proposed");
  const completed = actions.filter(a => a.status !== "proposed" && !a.testExecution);
  const testActions=actions.filter(a=>a.testExecution);
  const locked = busy || !connected || Boolean(pendingId);
  async function update(action: MissionAction, decision: "approve" | "dismiss") {
    if (!incident || locked) return;
    setPendingId(action.id); setNotice("");
    try {
      const ok = await act(decision === "approve" ? `Sending request to simulated ${services[action.service]}` : "Dismissing proposed request",
        `/actions/${action.id}/${decision}`,
        {incidentId: incident.id, expectedVersion: incident.version, ...(decision === "approve" ? {approvedBy: reviewer.trim()} : {})});
      setNotice(ok ? decision === "approve" ? "Service response received. The execution receipt is recorded below." : "Request dismissed. Its source and audit history remain available." : "The request was not updated. Review the server error above before retrying.");
    } finally { setPendingId(""); }
  }
  function card(action: MissionAction) {
    const sources = action.sourceObservationIds.map(id => incident?.observations.find(o => o.id === id)).filter(Boolean);
    return <article key={action.id} id={`action-${action.id}`} className={`mission-action ${action.status}`}>
      <div className="action-heading"><span className={`service-icon ${action.service}`}>{action.service === "ems" ? "✚" : action.service === "police" ? "⇄" : action.service === "fire" ? "◈" : "↗"}</span><div><span className="action-service">{services[action.service]} · {action.testExecution ? "real test-service execution" : "simulated connector"}</span><h3>{action.title}</h3></div><span className={`action-state ${action.status}`}>{action.status === "proposed" ? "Needs approval" : action.status === "acknowledged" ? "Confirmed" : action.status === "queued" ? "Saved · queued" : action.status === "executing" ? "Executing" : action.status === "failed" ? "Needs retry" : "Dismissed"}</span></div>
      <p>{action.detail}</p>
      {action.proposedBy && <p className="small muted" data-testid="external-proposer">Proposed by external agent: {action.proposedBy.agent}</p>}
      <div className="action-sources">{sources.map(o => o && <a key={o.id} href={`#observation-${o.id}`}>↗ {o.speaker} · {stamp(o.timestamp)}</a>)}</div>
      {action.status === "proposed" && <div className="action-controls"><button disabled={locked || !reviewer.trim()} onClick={() => void update(action, "approve")}>{pendingId === action.id ? "Processing…" : `Approve ${services[action.service]} request`}</button><button className="text-button" disabled={locked} onClick={() => void update(action, "dismiss")}>Dismiss</button></div>}
      {action.receipt && <div className="execution-receipt"><div><span>✓ EXECUTION RECEIPT</span><time>{stamp(action.receipt.timestamp)}</time></div><p>{action.receipt.message}</p><small>{action.receipt.service} · {action.approvedBy ? `approved by ${action.approvedBy}` : "automatic team update"}</small><code>{action.receipt.id}</code></div>}
      {action.testExecution && <div className="execution-receipt mission-test-receipt">
        <strong>{action.kind === "test_request" ? "Selected by Gemini mission planner" : "Planned by Gemini receipt agent"}</strong>
        <p>{action.testExecution.phase.replaceAll("_"," ")}</p>
        {action.testExecution.ticket && <><span>CONFIRMED DESTINATION TICKET</span><code data-testid="mission-ticket-receipt">{action.testExecution.ticket.id}</code><p>{action.testExecution.ticket.detail}</p><small>{action.testExecution.ticket.destination} · {stamp(action.testExecution.ticket.acceptedAt)}</small></>}
        {action.testExecution.sourceReceiptId && <p>Uses confirmed receipt <code>{action.testExecution.sourceReceiptId}</code>{action.testExecution.parentActionId && <a href={`#action-${action.testExecution.parentActionId}`}>View first action ↗</a>}</p>}
        {action.kind === "test_follow_up" && action.testExecution.followUp && <><span>CONFIRMED FOLLOW-UP RECEIPT</span><code data-testid="mission-follow-up-receipt">{action.testExecution.followUp.id}</code><p>{action.testExecution.followUp.message}</p></>}
        {action.testExecution.error && <p role="alert">{action.testExecution.error}</p>}
        {action.status === "failed" && <button disabled={locked} onClick={()=>{if(incident)void act("Retrying saved test execution",`/actions/${action.id}/retry-test`,{incidentId:incident.id});}}>Retry saved test action</button>}
      </div>}
      {action.status === "dismissed" && <small className="action-dismissed">Dismissed at {stamp(action.updatedAt)}. No service request was sent.</small>}
    </article>;
  }
  return <section className="panel mission-panel" aria-label="Mission orchestration">
    <div className="panel-heading"><div><p className="eyebrow">MISSION ORCHESTRATOR / VISIBLE EXECUTION</p><h2>From context to action.</h2></div><span className="mission-count">{waiting.length}<small>TO REVIEW</small></span></div>
    <p className="mission-explainer">New reports update shared mission memory. Team updates flow automatically; service requests wait for the dispatcher.</p>
    <div className="simulation-note">Emergency service connectors remain simulated. Enabled test-desk actions make real requests only to the controlled test service; no emergency units are dispatched.</div>
    {waiting.length > 0 && <label className="dispatcher-reviewer">Approving dispatcher<input value={reviewer} maxLength={80} onChange={e => setReviewer(e.target.value)} disabled={Boolean(pendingId)} aria-label="Approving dispatcher" /></label>}
    {testActions.length > 0 && <div className="mission-test-chain" aria-label="AI mission execution"><p className="eyebrow">MISSION REPORT → GEMINI ACTION → REAL RECEIPT → GEMINI FOLLOW-UP</p><div className="mission-actions" aria-live="polite">{testActions.map(card)}</div></div>}
    <div className="mission-actions" aria-live="polite">{waiting.map(card)}</div>
    {!waiting.length && <div className="mission-empty"><span>◎</span><div><strong>{actions.length ? "No requests waiting for approval." : "Ready for the first mission action."}</strong><p>{actions.length ? "Acknowledgments and source reports stay in the mission record." : "Try “Request an ambulance for two injured people.”"}</p></div></div>}
    {notice && <p className="action-notice" role="status">{notice}</p>}
    {completed.length > 0 && <details className="mission-history"><summary>Execution history <span>{completed.length}</span></summary><div className="mission-actions">{completed.slice().reverse().map(card)}</div></details>}
    <details className="agent-audit"><summary>Agent activity <span>{events.length}</span></summary>{!events.length ? <p className="small muted">No agent activity yet.</p> : <ol>{events.slice(-10).reverse().map(event => <li key={event.id}><span className={`agent-avatar ${event.agent}`}>{event.agent === "coordinator" ? "C" : event.agent === "dispatcher" ? "D" : "S"}</span><div><div className="audit-meta"><strong>{event.agent === "coordinator" ? "Coordinator" : event.agent === "dispatcher" ? "Dispatcher" : "Service adapter"}</strong><time>{stamp(event.timestamp)}</time></div><p>{event.message}</p>{event.actionId && <a href={`#action-${event.actionId}`}>View action ↗</a>}</div></li>)}</ol>}{events.length > 10 && <p className="small muted">Showing the latest 10 events. The complete audit remains in the mission record.</p>}</details>
    {events.some(e => /planning failed/i.test(e.message)) && <details className="planning-retry"><summary>Retry action planning for a saved report</summary><p className="small muted">A planning request failed earlier. The report was retained. Select its source before retrying.</p><label>Report<select value={retryReport} onChange={e=>setRetryReport(e.target.value)}><option value="">Select a report</option>{incident?.observations.map(o=><option key={o.id} value={o.id}>{stamp(o.timestamp)} · {o.speaker} · {o.text.slice(0,65)}</option>)}</select></label><button className="secondary" disabled={locked || !retryReport} onClick={()=>{if(incident)void act("Retrying mission planning",`/observations/${retryReport}/plan`,{incidentId:incident.id});}}>Retry selected report</button></details>}
  </section>;
}
