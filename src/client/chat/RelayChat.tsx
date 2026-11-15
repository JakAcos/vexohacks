import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Incident, MissionAction, Observation, ReportJob } from "../../shared/model";
import { latestIncident, ReportSubmissions } from "../../shared/mission-sync";
import "./relay-chat.css";

// ---------------------------------------------------------------------------
// Relay chat workspace. One mission = one conversation. Responders (each with a
// band) post like users; Relay's agents answer like an assistant, showing every
// step they take as a tool card with its receipt. Same API as the classic view.
// ---------------------------------------------------------------------------

type Health = { mode: "demo" | "gemini"; missionTestExecution?: boolean; geminiConfigured?: boolean };
type Source = { enabled: boolean; sourceMission?: string; targetMission?: string; origin?: string; bandNumber?: number; imported?: number; status?: string; error?: string };
type Band = { status: string; bandNumber: number; incidentId?: string; receivedPackets?: number; lastError?: string };

const params = new URLSearchParams(window.location.search);
const requested = params.get("incidentId");
const validId = (v: string | null) => !!v && /^[a-zA-Z0-9_-]{1,64}$/.test(v);

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) } : { cache: "no-store" });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((v as { error?: string }).error ?? `Request failed (${r.status}).`);
  return v as T;
}
const clock = (v?: string) => (v ? new Date(v).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "");
const short = (id?: string) => (id ? id.slice(0, 8) : "");
const secs = (a?: string, b?: string) => (a && b ? Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000) : undefined);

// ---- the cast: responders are characters, agents are Relay's bots ----
type Role = "ems" | "fire" | "police" | "dispatch" | "person";
function roleOf(name: string): Role {
  const n = name.toLowerCase();
  if (/medic|ems|ambulance|paramedic/.test(n)) return "ems";
  if (/engine|fire|ladder|truck/.test(n)) return "fire";
  if (/unit|police|officer|pd|patrol/.test(n)) return "police";
  if (/dispatch/.test(n)) return "dispatch";
  return "person";
}
const ROLE_GLYPH: Record<Role, string> = { ems: "✚", fire: "▲", police: "◆", dispatch: "◉", person: "●" };
const ROLE_LABEL: Record<Role, string> = { ems: "EMS", fire: "Fire", police: "Police", dispatch: "Dispatch", person: "Responder" };
const CAST = ["Engine 4", "Medic 7", "Unit 22", "Dispatch"];
const SUGGESTIONS = [
  { who: "Engine 4", text: "Training exercise: we need eight spare radio batteries at staging area Charlie. Log it and confirm." },
  { who: "Medic 7", text: "Training exercise: send two stretchers and an AED to the north gate staging area. Confirm when logged." },
  { who: "Unit 22", text: "Training exercise: we need twelve traffic cones at Linden Avenue and 5th for the road closure." },
];

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const r = roleOf(name);
  return <span className={`rc-av rc-av-${r}`} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>{ROLE_GLYPH[r]}</span>;
}
function RelayMark({ size = 30 }: { size?: number }) {
  return <svg className="rc-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
    <path d="M9 32V15.5C9 11 12 8.5 16.5 8.5H21" stroke="currentColor" strokeWidth="5.2" strokeLinecap="round" fill="none" />
    <circle cx="27.5" cy="25" r="6.2" stroke="currentColor" strokeWidth="3.6" fill="none" />
  </svg>;
}
function Wordmark() {
  return <span className="rc-word"><RelayMark size={26} /><b>relay</b></span>;
}
const Spinner = () => <span className="rc-spin" aria-hidden />;
const Check = () => <span className="rc-check" aria-hidden>✓</span>;

// ---- turn the mission record into a conversation ----
type Turn = { kind: "report"; obs: Observation; actions: MissionAction[]; followUps: MissionAction[] } | { kind: "pending"; job: ReportJob };
function buildTurns(inc?: Incident): Turn[] {
  if (!inc) return [];
  const byId = new Map(inc.actions.map(a => [a.id, a]));
  const turns: Turn[] = inc.observations.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map(obs => {
    const actions = inc.actions.filter(a => a.sourceObservationIds.includes(obs.id) && a.kind !== "test_follow_up");
    const followUps = inc.actions.filter(a => a.kind === "test_follow_up" && (a.sourceObservationIds.includes(obs.id) || actions.some(p => p.id === a.testExecution?.parentActionId || p.testExecution?.followUpActionId === a.id)));
    void byId;
    return { kind: "report", obs, actions, followUps };
  });
  const pending = (inc.reportJobs ?? []).filter(j => !j.observationId && j.status !== "complete" && j.result !== "silence");
  return [...turns, ...pending.map(job => ({ kind: "pending", job }) as Turn)];
}
const inputBadge = (o: Observation) => o.sourceDevice || o.importedFrom || o.inputKind === "vexo-audio" || o.inputKind === "vexo-transcript"
  ? `Band ${o.sourceDevice?.bandNumber ?? ""} · voice`.replace("  ", " ")
  : o.inputKind === "typed" ? "Typed" : o.inputKind === "vexo-simulated-text" ? "Band (simulated)" : "Voice";

// ---- Relay's agents: who does what (Gemini = Google DeepMind models; Vexo = the wristband) ----
const GEM = "/brand/gemini-color.svg", VEXO = "/brand/vexo-mark_w.svg";
type AgentKey = "input" | "listener" | "planner" | "desk" | "receipt";
const AGENT: Record<Exclude<AgentKey, "input">, { name: string; job: string; logo?: string; tone: string }> = {
  listener: { name: "Listener", job: "hears + writes it down", logo: GEM, tone: "mint" },
  planner: { name: "Planner", job: "decides what to do", logo: GEM, tone: "mint" },
  desk: { name: "Test Desk", job: "issues a receipt", tone: "amber" },
  receipt: { name: "Receipt agent", job: "checks + follows up", logo: GEM, tone: "mint" },
};
const isBand = (o?: Observation) => !!o && (!!o.sourceDevice || !!o.importedFrom || o.inputKind === "vexo-audio" || o.inputKind === "vexo-transcript");
type NodeState = "wait" | "run" | "done" | "fail";
function chainStates(obs: Observation, actions: MissionAction[], followUps: MissionAction[]): Record<AgentKey, NodeState> {
  const p = obs.processing, test = actions.find(a => a.testExecution), ticket = test?.testExecution?.ticket;
  const fu = followUps.find(f => f.testExecution?.followUp) ?? (test?.testExecution?.followUp ? test : undefined);
  const listening = !p || ["queued", "transcribing", "extracting"].includes(p);
  const failed = p === "failed" || test?.status === "failed";
  return {
    input: "done",
    listener: p === "failed" ? "fail" : listening && p !== "complete" && p !== "planning" ? "run" : "done",
    planner: p === "planning" ? "run" : listening && p !== "complete" ? "wait" : "done",
    desk: !test ? (p === "complete" ? "wait" : "wait") : ticket ? "done" : failed ? "fail" : "run",
    receipt: !ticket ? "wait" : fu ? "done" : failed ? "fail" : "run",
  };
}
function AgentChain({ obs, actions, followUps }: { obs: Observation; actions: MissionAction[]; followUps: MissionAction[] }) {
  const st = chainStates(obs, actions, followUps), band = isBand(obs);
  const nodes: [AgentKey, string, string, string | undefined, string][] = [
    ["input", band ? "Vexo band" : obs.inputKind === "typed" ? "Typed report" : "Voice report", obs.speaker, band ? VEXO : undefined, "blue"],
    ...(["listener", "planner", "desk", "receipt"] as const).map(k => [k, AGENT[k].name, AGENT[k].job, AGENT[k].logo, AGENT[k].tone] as [AgentKey, string, string, string | undefined, string]),
  ];
  const lastDone = nodes.reduce((n, [k], i) => st[k] === "done" ? i : n, 0);
  return <div className="rc-chain" aria-label="Agents working on this report">
    <div className="rc-chain-track"><div className="rc-chain-fill" style={{ width: `${(lastDone / (nodes.length - 1)) * 100}%` }} /></div>
    {nodes.map(([k, name, job, logo, tone]) => <div key={k} className={`rc-node rc-node-${st[k]} rc-tone-${tone}`}>
      <span className="rc-node-ic">{logo ? <img src={logo} alt="" /> : k === "desk" ? "▤" : "●"}{st[k] === "done" && <i>✓</i>}</span>
      <b>{name}</b><small>{st[k] === "run" ? "working…" : job}</small>
    </div>)}
  </div>;
}
function AgentTag({ k }: { k: Exclude<AgentKey, "input"> }) {
  const a = AGENT[k]; return <span className={`rc-tag rc-tone-${a.tone}`}>{a.logo ? <img src={a.logo} alt="" /> : <span>▤</span>}{a.name}{a.logo && <em>Gemini</em>}</span>;
}

// ---- one agent step, Grok-style tool card ----
function Step({ state, title, children }: { state: "run" | "done" | "wait" | "fail"; title: React.ReactNode; children?: React.ReactNode }) {
  return <div className={`rc-step rc-step-${state}`}>
    <span className="rc-step-dot">{state === "run" ? <Spinner /> : state === "done" ? <Check /> : state === "fail" ? "!" : "•"}</span>
    <div className="rc-step-body"><div className="rc-step-title">{title}</div>{children && <div className="rc-step-sub">{children}</div>}</div>
  </div>;
}

function ActionSteps({ a, follow, incident, act, busy }: { a: MissionAction; follow?: MissionAction; incident: Incident; act: (path: string, body: unknown) => Promise<void>; busy: boolean }) {
  const te = a.testExecution;
  if (te) {
    const ticket = te.ticket, fu = follow?.testExecution?.followUp ?? te.followUp;
    const phase = te.phase;
    return <>
      <Step state="done" title={<><AgentTag k="planner" /> chose <b>{a.title}</b> <span className="rc-pill">→ Test Desk</span></>}>{a.detail}</Step>
      <Step state={ticket ? "done" : phase === "failed" ? "fail" : "run"} title={ticket ? <><AgentTag k="desk" /> saved the request · receipt <span className="rc-receipt">#{short(ticket.id)}</span></> : phase === "failed" ? "Sending failed — saved for retry" : "Sending request to Test Desk…"}>
        {ticket && <>Receipt {clock(ticket.acceptedAt)}</>}
      </Step>
      {ticket && <Step state={fu ? "done" : phase === "failed" || follow?.status === "failed" ? "fail" : "run"} title={fu ? <><AgentTag k="receipt" /> checked <span className="rc-receipt">#{short(ticket.id)}</span> and logged a follow-up <span className="rc-receipt">#{short(fu.id)}</span></> : "Receipt agent reading the receipt…"}>
        {fu ? fu.message : null}
      </Step>}
      {(a.status === "failed" || follow?.status === "failed") && <button className="rc-btn rc-btn-ghost" disabled={busy} onClick={() => void act(`/actions/${(follow?.status === "failed" ? follow : a).id}/retry-test`, { incidentId: incident.id })}>Retry saved step</button>}
    </>;
  }
  if (a.kind === "team_update") return <div className="rc-broadcast">
    <div className="rc-bc-head"><span className="rc-bc-ic">📣</span><AgentTag k="planner" /> alerted every unit on this mission</div>
    <b className="rc-bc-title">{a.title}</b><p>{a.detail}</p>
    <div className="rc-bc-units">{["Engine 4", "Medic 7", "Dispatch"].map(u => <span key={u} className="rc-chip"><Avatar name={u} size={18} />{u}<i>✓ shared</i></span>)}</div>
  </div>;
  // emergency service requests always wait for a human
  if (a.status === "proposed") return <div className="rc-approve">
    <div className="rc-approve-head"><span className="rc-pill rc-pill-amber">Needs your OK</span><b>{a.title}</b></div>
    <p>{a.detail}</p>
    <div className="rc-approve-row">
      <button className="rc-btn rc-btn-primary" disabled={busy} onClick={() => void act(`/actions/${a.id}/approve`, { incidentId: incident.id, expectedVersion: incident.version, approvedBy: "Dispatcher" })}>Approve</button>
      <button className="rc-btn rc-btn-ghost" disabled={busy} onClick={() => void act(`/actions/${a.id}/dismiss`, { incidentId: incident.id, expectedVersion: incident.version })}>Dismiss</button>
    </div>
    <small>Simulated connector · nothing is sent to real emergency services.</small>
  </div>;
  if (a.status === "dismissed") return <Step state="wait" title={<>Dismissed: {a.title}</>}>No request was sent.</Step>;
  return <Step state={a.receipt ? "done" : "run"} title={<>{a.title} <span className="rc-pill">simulated {a.service.toUpperCase()}</span></>}>{a.receipt ? `${a.receipt.message} · approved by ${a.approvedBy ?? "dispatcher"}` : "Sending…"}</Step>;
}

function RelayReply({ t, incident, act, busy, events }: { t: Extract<Turn, { kind: "report" }>; incident: Incident; act: (path: string, body: unknown) => Promise<void>; busy: boolean; events: Incident["agentEvents"] }) {
  const { obs, actions, followUps } = t;
  const [open, setOpen] = useState(false);
  const working = obs.processing && obs.processing !== "complete" && obs.processing !== "failed";
  const facts = obs.facts.map(f => f.label);
  const lastFu = followUps.map(f => f.testExecution?.followUp?.acceptedAt).filter(Boolean).sort().pop();
  const doneIn = secs(obs.timestamp, lastFu as string | undefined);
  const mine = events.filter(e => actions.some(a => a.id === e.actionId) || followUps.some(a => a.id === e.actionId) || e.message.includes(obs.speaker));
  const thinking = obs.processing === "extracting" ? "Reading the report…" : obs.processing === "transcribing" ? "Listening to the band audio…" : obs.processing === "planning" ? "Deciding what to do…" : obs.processing === "queued" ? "Queued…" : "";
  return <div className="rc-msg rc-msg-relay">
    <div className="rc-msg-head"><span className="rc-av rc-av-relay"><RelayMark size={18} /></span><b>Relay</b>
      {mine.length > 0 && <button className="rc-think" onClick={() => setOpen(v => !v)}>{doneIn !== undefined ? `Agents finished in ${doneIn.toFixed(1)} s` : working ? "Working" : "Agent log"} <span className={open ? "rc-caret open" : "rc-caret"}>›</span></button>}
    </div>
    {open && <ol className="rc-log">{mine.map(e => <li key={e.id}><span className={`rc-log-who rc-log-${e.agent}`}>{e.agent === "coordinator" ? "Planner" : e.agent === "dispatcher" ? "Dispatcher" : "Test Desk"}</span>{e.message}<time>{clock(e.timestamp)}</time></li>)}</ol>}
    <AgentChain obs={obs} actions={actions} followUps={followUps} />
    <div className="rc-steps">
      {working ? <Step state="run" title={<span className="rc-shimmer">{thinking}</span>} /> :
        obs.processing === "failed" ? <Step state="fail" title="Couldn't process this report — it's saved." /> :
          <Step state="done" title={<><AgentTag k="listener" /> understood {obs.speaker}'s report</>}>{facts.length ? facts.join(" · ") : obs.text}</Step>}
      {actions.map(a => <ActionSteps key={a.id} a={a} follow={followUps.find(f => f.testExecution?.parentActionId === a.id || a.testExecution?.followUpActionId === f.id)} incident={incident} act={act} busy={busy} />)}
      {!working && obs.factsReady !== false && obs.processing !== "failed" && actions.length === 0 && obs.processing === "complete" && <Step state="wait" title="Noted in the shared mission — no action needed." />}
    </div>
    {doneIn !== undefined && <div className="rc-done"><span className="rc-dot-ok" />Done · {doneIn.toFixed(1)} s from {obs.speaker}'s words to a confirmed follow-up · linked to the original report</div>}
  </div>;
}

function ContextDrawer({ inc, onClose }: { inc?: Incident; onClose: () => void }) {
  const facts = (inc?.observations ?? []).flatMap(o => o.facts.map(f => ({ f, o })));
  const receipts = (inc?.actions ?? []).flatMap(a => [a.testExecution?.ticket && { id: a.testExecution.ticket.id, what: a.title, at: a.testExecution.ticket.acceptedAt }, a.testExecution?.followUp && { id: a.testExecution.followUp.id, what: "Follow-up", at: a.testExecution.followUp.acceptedAt }].filter(Boolean) as { id: string; what: string; at: string }[]);
  const seen = new Set<string>(); const uniq = receipts.filter(r => !seen.has(r.id) && !!seen.add(r.id));
  const people = Array.from(new Set((inc?.observations ?? []).map(o => o.speaker)));
  return <aside className="rc-drawer" aria-label="Shared mission context">
    <div className="rc-drawer-head"><b>Shared context</b><button className="rc-icon" onClick={onClose} aria-label="Close">✕</button></div>
    <p className="rc-muted">Everything the agents know about this mission. Every line links back to who said it.</p>
    <h4>On this mission</h4>
    <div className="rc-chips">{people.length ? people.map(p => <span key={p} className="rc-chip"><Avatar name={p} size={18} />{p}</span>) : <span className="rc-muted">No reports yet.</span>}</div>
    <h4>Known facts</h4>
    <ul className="rc-facts">{facts.length ? facts.map(({ f, o }, i) => <li key={i}>{f.label}<small>{o.speaker} · {clock(o.timestamp)}</small></li>) : <li className="rc-muted">Nothing yet.</li>}</ul>
    <h4>Receipts</h4>
    <ul className="rc-facts">{uniq.length ? uniq.map(r => <li key={r.id}>{r.what}<small><span className="rc-receipt">#{short(r.id)}</span> · {clock(r.at)}</small></li>) : <li className="rc-muted">No receipts yet.</li>}</ul>
  </aside>;
}

function App() {
  const [health, setHealth] = useState<Health>();
  const [source, setSource] = useState<Source>();
  const [band, setBand] = useState<Band>();
  const [missionId, setMissionId] = useState<string | undefined>(validId(requested) ? requested! : undefined);
  const [inc, setInc] = useState<Incident>();
  const [live, setLive] = useState(false);
  const [text, setText] = useState("");
  const [who, setWho] = useState(() => localStorage.getItem("relay.who") || "Engine 4");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [castOpen, setCastOpen] = useState(false);
  const subs = useRef(new ReportSubmissions());
  const srcRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const recents = useMemo(() => { try { return JSON.parse(localStorage.getItem("relay.missions") || "[]") as string[]; } catch { return []; } }, [missionId]);

  useEffect(() => { void api<Health>("/health").then(setHealth).catch(() => undefined); }, []);
  useEffect(() => { // follow a linked band source, if this instance has one
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => { try { const s = await api<Source>("/mission-source"); srcRef.current = !!s.enabled; if (!stop) { setSource(s); if (!missionId && s.enabled && s.targetMission) setMissionId(s.targetMission); } } catch { /* offline */ }
      try { const b = await api<Band>(srcRef.current ? "/band/source" : "/band/session"); if (!stop) setBand(b); } catch { if (!stop && srcRef.current) setBand(undefined); }
      if (!stop) timer = setTimeout(tick, 2000); };
    void tick(); return () => { stop = true; clearTimeout(timer); };
  }, [missionId]);
  useEffect(() => { if (!missionId && source && !source.enabled) setMissionId("relay-live"); }, [source, missionId]);
  useEffect(() => {
    if (!missionId) return;
    const url = new URL(window.location.href); url.searchParams.set("incidentId", missionId); window.history.replaceState(null, "", url);
    try { const list = [missionId, ...recents.filter(r => r !== missionId)].slice(0, 6); localStorage.setItem("relay.missions", JSON.stringify(list)); } catch { /* private mode */ }
    setInc(undefined);
    const es = new EventSource(`/api/incidents/${missionId}/events`);
    es.addEventListener("incident", e => { setInc(cur => latestIncident(cur, JSON.parse((e as MessageEvent).data))); setLive(true); });
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [missionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [inc?.revision, inc?.updatedAt]);
  useEffect(() => { try { localStorage.setItem("relay.who", who); } catch { /* ignore */ } }, [who]);

  const turns = useMemo(() => buildTurns(inc), [inc]);
  const following = !!source?.enabled;
  const bandOn = !!band && ["listening", "connecting", "reconnecting"].includes(band.status);
  const bandNo = band?.bandNumber || source?.bandNumber;
  const bandLive = bandOn;
  const bandLabel = !band || !bandNo ? (following ? "Band source offline" : "No band paired") : `Band ${bandNo} · ${band.status === "listening" ? "listening" : band.status === "connecting" ? "connecting…" : band.status === "reconnecting" ? "reconnecting…" : band.status === "stopping" ? "finishing…" : band.status === "error" ? "needs attention" : "tap to listen"}`;

  async function act(path: string, body: unknown) {
    setBusy(true); setErr("");
    try { const v = await api<Incident | { incident?: Incident }>(path, body); const next = (v as { incident?: Incident }).incident ?? (v as Incident); if (next && (next as Incident).observations) setInc(cur => latestIncident(cur, next as Incident)); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function send(t = text, speaker = who) {
    const body = t.trim(); if (!body || !missionId || busy) return;
    const report = subs.current.prepare(missionId, speaker, body);
    setText(""); await act("/observations", { ...report, inputKind: "typed" }); subs.current.confirm(report);
    boxRef.current?.focus();
  }
  async function toggleBand() {
    if (!band || !bandNo || !missionId) return;
    const base = following ? "/band/source" : "/band/session";
    try { setBand(await api<Band>(`${base}/${bandOn ? "stop" : "start"}`, bandOn ? {} : following ? { speaker: who } : { incidentId: missionId, speaker: who })); } catch (e) { setErr((e as Error).message); }
  }
  function newMission() { const id = `mission-${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "")}`; setMissionId(id); }

  const empty = turns.length === 0;
  const composer = <div className={`rc-composer ${empty ? "rc-composer-hero" : ""}`}>
    <div className="rc-who">
      <button className="rc-who-btn" onClick={() => setCastOpen(v => !v)} aria-haspopup="listbox"><Avatar name={who} size={22} /><span>{who}</span><span className="rc-caret">⌄</span></button>
      {castOpen && <div className="rc-who-menu" role="listbox">{CAST.map(c => <button key={c} role="option" aria-selected={c === who} onClick={() => { setWho(c); setCastOpen(false); }}><Avatar name={c} size={22} /><span>{c}</span><small>{ROLE_LABEL[roleOf(c)]}</small></button>)}</div>}
    </div>
    <textarea ref={boxRef} rows={1} value={text} placeholder={empty ? "What's happening on scene?" : `Report as ${who}…`} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} aria-label="Report" />
    <button className={`rc-band ${bandLive ? "on" : ""}`} onClick={() => void toggleBand()} disabled={!band || !bandNo || band.status === "stopping"} title={bandOn ? "Stop band listening" : `Start listening on the band as ${who}`}><span className="rc-band-dot" />{bandLabel}</button>
    <button className="rc-send" disabled={!text.trim() || busy || !missionId} onClick={() => void send()} aria-label="Send report">↑</button>
  </div>;

  return <div className="rc">
    <aside className="rc-side">
      <div className="rc-side-top"><Wordmark /></div>
      <button className="rc-new" onClick={newMission}><span>＋</span> New mission</button>
      <div className="rc-side-label">Missions</div>
      <nav className="rc-missions">{(missionId ? [missionId, ...recents.filter(r => r !== missionId)] : recents).slice(0, 6).map(m => <button key={m} className={m === missionId ? "on" : ""} onClick={() => setMissionId(m)}>{m}</button>)}</nav>
      <div className="rc-side-label">Team</div>
      <div className="rc-team">
        {CAST.slice(0, 3).map(c => <div key={c} className="rc-member"><Avatar name={c} size={24} /><span>{c}</span><small>{ROLE_LABEL[roleOf(c)]}</small></div>)}
        {(["listener", "planner", "receipt"] as const).map(k => <div key={k} className="rc-member"><span className="rc-av rc-av-gem" style={{ width: 24, height: 24 }}><img src={GEM} alt="" /></span><span>{AGENT[k].name}</span><small>Gemini agent · {AGENT[k].job}</small></div>)}
      </div>
      <div className="rc-side-foot"><div className="rc-powered"><small>Powered by</small><img src="/brand/vexo-wordmark-rounded_w.svg" alt="Vexo" className="rc-pw-vexo" /><img src="/brand/deepmind-color.svg" alt="" className="rc-pw-dm" /><img src="/brand/gemini-text_w.svg" alt="Gemini" className="rc-pw-gem" /></div><span className="rc-pill rc-pill-amber">Test mode</span><small>Controlled Test Desk. No real emergency services are connected.</small><a href="?view=classic">Open classic dashboard</a></div>
    </aside>
    <main className="rc-main">
      <header className="rc-top">
        <div className="rc-title"><b>{missionId ?? "…"}</b><span className={`rc-live ${live ? "on" : ""}`}>{live ? "live" : "connecting"}</span>{following && <span className="rc-pill">following {source?.sourceMission}</span>}</div>
        <div className="rc-top-right">
          <span className="rc-model">Relay · {health?.mode === "gemini" ? "Gemini agents" : "demo agents"}</span>
          <button className="rc-btn rc-btn-ghost" onClick={() => setDrawer(v => !v)}>Shared context {inc ? <span className="rc-count">{inc.observations.reduce((n, o) => n + o.facts.length, 0)}</span> : null}</button>
        </div>
      </header>
      {empty ? <section className="rc-hero">
        <div className="rc-hero-mark"><RelayMark size={64} /></div>
        <h1>One mission. Every responder. Agents that act on it.</h1>
        <p>Speak into a band or type a report. Relay understands it, asks the right service, and shows you every receipt.</p>
        {composer}
        <div className="rc-suggest">{SUGGESTIONS.map(s => <button key={s.text} onClick={() => { setWho(s.who); setText(s.text); boxRef.current?.focus(); }}><Avatar name={s.who} size={20} /><span><b>{s.who}</b> {s.text.replace("Training exercise: ", "")}</span></button>)}</div>
      </section> : <>
        <section className="rc-thread" aria-live="polite">
          {turns.map(t => t.kind === "pending" ? <div key={t.job.id} className="rc-msg rc-msg-user">
            <div className="rc-msg-head"><Avatar name={t.job.speaker} /><b>{t.job.speaker}</b><span className="rc-badge">{t.job.sourceDevice ? `Band ${t.job.sourceDevice.bandNumber} · voice` : "Voice"}</span></div>
            <div className="rc-bubble rc-bubble-pending"><span className="rc-shimmer">{t.job.status === "transcribing" ? "Turning speech into text…" : t.job.status === "failed" ? "Saved — needs retry" : "Saving the report…"}</span></div>
          </div> : <React.Fragment key={t.obs.id}>
            <div className="rc-msg rc-msg-user" id={`observation-${t.obs.id}`}>
              <div className="rc-msg-head"><Avatar name={t.obs.speaker} /><b>{t.obs.speaker}</b><span className={`rc-badge ${isBand(t.obs) ? "rc-badge-vexo" : ""}`}>{isBand(t.obs) && <img src={VEXO} alt="" />}{inputBadge(t.obs)}</span><time>{clock(t.obs.timestamp)}</time></div>
              <div className="rc-bubble">{t.obs.text}</div>
            </div>
            {inc && <RelayReply t={t} incident={inc} act={act} busy={busy} events={inc.agentEvents} />}
          </React.Fragment>)}
          <div ref={endRef} />
        </section>
        <div className="rc-dock">{composer}<p className="rc-fine">Relay is a hackathon prototype. Requests go to a controlled Test Desk; no real emergency services are connected.</p></div>
      </>}
      {err && <div className="rc-toast" role="alert">{err}<button className="rc-icon" onClick={() => setErr("")}>✕</button></div>}
    </main>
    {drawer && <ContextDrawer inc={inc} onClose={() => setDrawer(false)} />}
  </div>;
}

document.body.classList.add("rc-body");
createRoot(document.getElementById("root")!).render(<App />);
