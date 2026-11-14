import React, { useEffect, useRef, useState } from "react";
import type { DispatchRun, DispatchSnapshot } from "../shared/test-dispatch";
import "./test-dispatch.css";

const labels = { submitting: "Submitting ticket", following_up: "Confirming follow-up", complete: "Both receipts confirmed", failed: "Needs retry" };
export function TestDispatch({ missionId }: { missionId: string }) {
  const [snapshot, setSnapshot] = useState<DispatchSnapshot>();
  const [title, setTitle] = useState("Confirm supply pickup at the test staging desk");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const pending = useRef<{ id: string; title: string } | undefined>(undefined);
  const inFlight = useRef(false);
  const storageKey = `relay-test-dispatch:${missionId}`;
  const path = `/api/incidents/${encodeURIComponent(missionId)}/test-dispatch`;
  async function request(url: string, body?: unknown) {
    const res = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) } : { signal: AbortSignal.timeout(10000) });
    const value = await res.json();
    if (!res.ok) throw new Error(value.error ?? "Could not reach Relay.");
    return value;
  }
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    pending.current = undefined; setSnapshot(undefined); setError(""); setConnectionError("");
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) { const saved = JSON.parse(stored); if (typeof saved.id === "string" && typeof saved.title === "string") { pending.current = saved; setTitle(saved.title); } }
    } catch { /* Session storage may be unavailable. The server retains accepted requests. */ }
    const refresh = async () => {
      try {
        const value: DispatchSnapshot = await request(path);
        if (!stopped) {
          setSnapshot(value);
          setConnectionError("");
          if (!inFlight.current && pending.current && value.runs.some(r => r.id === pending.current!.id)) {
            pending.current = undefined; try { sessionStorage.removeItem(storageKey); } catch {}
            setError("");
          }
        }
      } catch (e) { if (!stopped) setConnectionError((e as Error).message); }
      if (!stopped) timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [missionId]);
  async function start() {
    if (inFlight.current || busy || !title.trim()) return;
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      pending.current ??= { id: crypto.randomUUID(), title: title.trim() };
      try { sessionStorage.setItem(storageKey, JSON.stringify(pending.current)); } catch {}
      await request(path, { clientRequestId: pending.current.id, title: pending.current.title });
      pending.current = undefined; try { sessionStorage.removeItem(storageKey); } catch {}
      setSnapshot(await request(path));
    } catch (e) {
      // A lost POST response is not a failed submission. Reconcile against the
      // saved run before inviting a retry; polling must not clear its identity.
      try {
        const saved: DispatchSnapshot = await request(path);
        if (pending.current && saved.runs.some(r => r.id === pending.current!.id)) {
          pending.current = undefined; try { sessionStorage.removeItem(storageKey); } catch {}
          setSnapshot(saved); setError("");
        } else setError((e as Error).message + " Retry preserves the same request ID.");
      } catch { setError((e as Error).message + " Retry preserves the same request ID."); }
    }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function retry(run: DispatchRun) {
    setBusy(true); setError("");
    try { await request(`${path}/${run.id}/retry`, {}); setSnapshot(await request(path)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function download(run: DispatchRun) {
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `relay-test-receipts-${run.id}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!snapshot?.enabled && !snapshot?.runs.length) return null;
  const active = snapshot?.runs.some(r => ["submitting", "following_up"].includes(r.status));
  const run = snapshot?.runs[0];
  return <section className="panel test-dispatch" id="test-dispatch" aria-label="Real test dispatch">
    <div className="panel-heading"><div><p className="eyebrow">CONNECTED TEST DESTINATION</p><h2>One request. Two dispatchers.</h2></div><span className="test-desk-badge">REAL HTTP · TEST DATA</span></div>
    <p>Dispatcher A submits a test ticket. Dispatcher B reads the accepted ticket and sends a linked follow-up.</p>
    <p className="test-desk-destination">Relay Test Desk <code>{snapshot?.destination ?? run?.destination}</code></p>
    <form onSubmit={e => { e.preventDefault(); void start(); }}>
      <label htmlFor="test-dispatch-title">Synthetic test request</label>
      <div className="test-dispatch-form"><input id="test-dispatch-title" value={title} maxLength={160} disabled={busy || active || Boolean(pending.current)} onChange={e => setTitle(e.target.value)} /><button disabled={busy || active || !snapshot?.enabled || !title.trim()} type="submit">{busy ? "Saving…" : active ? "Dispatchers working…" : pending.current ? "Recover submission" : "Run test dispatch"}</button></div>
    </form>
    <p className="test-desk-note">A separate local service receives these requests. No emergency service is contacted. These two workers follow a fixed workflow.</p>
    {error && <p role="alert" className="test-dispatch-error">{error}</p>}
    {connectionError && <p role="status" className="test-dispatch-error">Reconnecting to Relay. Saved receipts will appear when the connection returns.</p>}
    {run && <div className="test-run" aria-live="polite">
      <div className="test-run-heading"><strong>{run.title}</strong><span className={`test-run-state ${run.status}`}>{labels[run.status]}</span></div>
      <div className="test-dispatch-steps">
        <article className={run.ticket ? "confirmed" : ""}><span className="test-worker">A</span><h3>Submit ticket</h3><p>{run.ticket ? "Accepted by the test desk" : run.status === "failed" ? "Submission not confirmed" : "Waiting for the destination"}</p>{run.ticket && <><span className="test-receipt-label">DESTINATION RECEIPT</span><code data-testid="ticket-receipt">{run.ticket.id}</code><time>{new Date(run.ticket.acceptedAt).toLocaleString()}</time></>}</article>
        <span className="test-handoff" aria-label="Receipt handoff">→</span>
        <article className={run.followUp ? "confirmed" : ""}><span className="test-worker">B</span><h3>Use the result</h3><p>{run.followUp ? "Follow-up accepted and read back" : run.status === "failed" ? "Follow-up not confirmed" : run.ticket ? "Reading ticket and submitting follow-up" : "Waiting for A’s confirmed ticket"}</p>{run.followUp && <><span className="test-receipt-label">DESTINATION RECEIPT</span><code data-testid="follow-up-receipt">{run.followUp.id}</code><time>{new Date(run.followUp.acceptedAt).toLocaleString()}</time></>}</article>
      </div>
      {run.followUp && <div className="test-final-result"><strong>Confirmed result</strong><p>{run.followUp.message}</p><small>Linked to A’s receipt: <code data-testid="source-receipt">{run.followUp.sourceReceiptId}</code></small></div>}
      {run.error && <div className="test-dispatch-error"><p>{run.error}</p><button disabled={busy || active || !snapshot?.enabled} onClick={() => void retry(run)}>Retry this dispatch</button></div>}
      <details><summary>Handoffs and receipt evidence</summary><ol>{run.events.map((event, i) => <li key={i}><strong>{event.worker.replaceAll("_", " ")}</strong><p>{event.message}</p><time>{new Date(event.timestamp).toLocaleTimeString()}</time></li>)}</ol><pre>{JSON.stringify({ destination: run.destination, runId: run.id, ticket: run.ticket, followUp: run.followUp }, null, 2)}</pre><button className="secondary" onClick={() => download(run)}>Download receipt evidence</button></details>
    </div>}
    {(snapshot?.runs.length ?? 0) > 1 && <details><summary>Earlier test dispatches ({snapshot!.runs.length - 1})</summary>{snapshot!.runs.slice(1).map(previous => <div className="test-previous" key={previous.id}><span>{previous.title} · {labels[previous.status]}</span><button className="text-button" onClick={() => download(previous)}>Receipts</button>{previous.status === "failed" && <button disabled={busy || active} onClick={() => void retry(previous)}>Retry</button>}</div>)}</details>}
  </section>;
}
