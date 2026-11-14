import React, { useEffect, useRef, useState } from "react";
import "./BandListening.css";

type BandSession = {
  status: "idle" | "connecting" | "listening" | "reconnecting" | "stopping" | "stopped" | "error";
  bandNumber: number;
  incidentId?: string;
  speaker?: string;
  startedAt?: string;
  receivedPackets: number;
  queuedReports: number;
  acknowledgedReports: number;
  pendingReports: number;
  lastReportAt?: string;
  lastError?: string;
  pid?: number;
};
type Props = {
  incidentId: string;
  speaker: string;
  onSpeaker: (speaker: string) => void;
  onActive: (active: boolean) => void;
  externalBusy: boolean;
};
const activeStatuses = new Set(["connecting", "listening", "reconnecting", "stopping"]);
const labels = { idle: "Ready", connecting: "Connecting to band", listening: "Listening", reconnecting: "Reconnecting to band", stopping: "Stopping · finishing reports", stopped: "Stopped", error: "Needs attention" };

export function BandListening({ incidentId, speaker, onSpeaker, onActive, externalBusy }: Props) {
  const [session, setSession] = useState<BandSession>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"start" | "stop" | "retry" | "">("");
  const [reachable, setReachable] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const mutating = useRef(false);
  const running = !!session && (activeStatuses.has(session.status) || (session.status === "error" && !!session.pid));
  const retained = (session?.pendingReports ?? 0) > 0;
  const locked = running || retained || !!pending || uncertain;
  const otherMission = !!session?.incidentId && session.incidentId !== incidentId && locked;

  useEffect(() => { onActive(locked); }, [locked, onActive]);
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    async function poll() {
      if (!mutating.current) {
        const current = generation.current;
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 8000);
        try {
          const response = await fetch("/api/band/session", { signal: controller.signal, cache: "no-store" });
          const value = await response.json();
          if (!response.ok) throw new Error(value.error || "Band status is unavailable.");
          if (mounted.current && current === generation.current) {
            setSession(value); setReachable(true); setUncertain(false); setError("");
          }
        } catch {
          if (mounted.current && current === generation.current) {
            setReachable(false);
            setError("Cannot confirm band status. Listening may still be active; reconnect or use Stop below.");
          }
        } finally { clearTimeout(timeout); }
      }
      if (mounted.current) timer = setTimeout(() => void poll(), 2000);
    }
    void poll();
    return () => { mounted.current = false; clearTimeout(timer); controller?.abort(); };
  }, []);

  async function control(command: "start" | "stop" | "retry") {
    if (mutating.current) return;
    mutating.current = true;
    generation.current += 1;
    setPending(command); setError("");
    try {
      const response = await fetch(`/api/band/session/${command}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command === "start" ? { incidentId, speaker } : {}),
        signal: AbortSignal.timeout(15000),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || `Could not ${command} band listening.`);
      if (mounted.current) { setSession(value); setReachable(true); setUncertain(false); }
    } catch (failure) {
      if (mounted.current) {
        setError(`${(failure as Error).message} Check the band status before trying again.`);
        setReachable(false);
        setUncertain(true);
      }
    } finally {
      mutating.current = false;
      if (mounted.current) setPending("");
    }
  }

  return <section id="band-input" className="panel band-listening" aria-labelledby="band-listening-heading">
    <div className="band-heading">
      <div><p className="eyebrow">PHYSICAL WEARABLE · VEXO BAND 38</p><h2 id="band-listening-heading">Listen throughout the mission.</h2></div>
      <span className={`band-status ${reachable ? session?.status ?? "" : "unknown"}`} role="status">
        <i />{pending === "start" ? "Starting…" : pending === "stop" ? "Requesting stop…" : pending === "retry" ? "Retrying saved reports…" : !reachable ? "Checking connection" : session ? labels[session.status] : "Checking band"}
      </span>
    </div>
    <p className="band-notice">Starting sends nearby speech from band 38 to Gemini and saves reports in this mission until you stop. Make sure everyone nearby agrees to being recorded.</p>
    <div className="band-controls">
      <label>Speaking as<select value={locked ? session?.speaker || speaker : speaker} disabled={locked || externalBusy} onChange={e => onSpeaker(e.target.value)}>
        {["Firefighter A", "Firefighter B", "911 Dispatcher", "Police Officer", "EMS Paramedic", "Team lead"].map(role => <option key={role}>{role}</option>)}
      </select></label>
      <button type="button" disabled={!reachable || locked || externalBusy} onClick={() => void control("start")}>Start mission listening</button>
      <button type="button" className="secondary" disabled={!!pending || (reachable && !running)} onClick={() => void control("stop")}>Stop band listening</button>
    </div>
    <p className="band-binding">{locked ? <>Bound to mission <strong>{session?.incidentId || incidentId}</strong> · {session?.speaker || speaker}</> : <>Next session: <strong>{incidentId}</strong></>}{otherMission && <> · Open that mission to see its reports.</>}</p>
    <dl className="band-counts band-report-counts">
      <div><dt>Audio segments saved</dt><dd>{session?.acknowledgedReports ?? 0}</dd></div>
      <div><dt>Waiting to send</dt><dd>{session?.pendingReports ?? 0}</dd></div>
    </dl>
    <details className="band-diagnostics"><summary>Connection details</summary>
      <dl className="band-counts">
        <div><dt>Audio packets received</dt><dd>{session?.receivedPackets ?? 0}</dd></div>
        <div><dt>Reports queued</dt><dd>{session?.queuedReports ?? 0}</dd></div>
      </dl>
      <p className="band-last-report">Saved audio is processed in the background. Silence does not become a report; completed reports and actions appear in the mission.</p>
    </details>
    {session?.lastReportAt && <p className="band-last-report">Last report: {new Date(session.lastReportAt).toLocaleTimeString()}</p>}
    {(error || session?.lastError) && <p className="band-error" role="alert">{error || session?.lastError}</p>}
    {retained && !running && <div className="band-retry"><p className="band-notice">Saved audio is waiting to send. Retry delivery without turning on the microphone.</p><button type="button" className="secondary" disabled={!!pending || !reachable} onClick={() => void control("retry")}>Retry saved reports</button></div>}
  </section>;
}
