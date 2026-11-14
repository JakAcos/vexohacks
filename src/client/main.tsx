import { ReportProgress } from "./ReportProgress";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { scenario, type Incident, type Issue } from "../shared/model";
import "./style.css";
import { VoiceConsole } from "./VoiceConsole";
import { BandListening } from "./BandListening";
import { MissionActions } from "./MissionActions";
import { MissionSourceStatus } from "./MissionSourceStatus";
import { TestDispatch } from "./TestDispatch";
import { SponsorEvidence } from "./SponsorEvidence";
import { sponsorEvidence } from "../shared/sponsorEvidence";
import { latestIncident, ReportSubmissions } from "../shared/mission-sync";
import "./mission-design.css";
type Health = {
  missionTestExecution?: boolean;
  missionSource?: {sourceMission:string;targetMission:string};
  mode: "demo" | "gemini";
  roles: Record<string, string>;
  voice: {
    gemini: { configured: boolean };
    deepgram: { configured: boolean };
    minimax: { configured: boolean };
  };
};
const requestedId = new URLSearchParams(window.location.search).get(
  "incidentId",
);
const incidentId =
  requestedId && /^[a-zA-Z0-9_-]{1,64}$/.test(requestedId)
    ? requestedId
    : "apartment-demo";
async function request(path: string, body?: unknown) {
  const response = await fetch(
    `/api${path}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000),
        }
      : undefined,
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed.");
  return result;
}
const time = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
function App() {
  const [state, setState] = useState<Incident>(),
    [health, setHealth] = useState<Health>(),
    [connected, setConnected] = useState(false),
    [operation, setBusy] = useState(""),
    [voiceActive, setVoiceActive] = useState(false),
    [bandActive, setBandActive] = useState(false),
    [presenting, setPresenting] = useState(false),
    [missionDraft, setMissionDraft] = useState(incidentId),
    [linkStatus, setLinkStatus] = useState(""),
    [error, setError] = useState(""),
    [speaker, setSpeaker] = useState("Firefighter A"),
    [text, setText] = useState(""),
    [latency, setLatency] = useState<number>(),
    [reviewed, setReviewed] = useState(false),
    [lead, setLead] = useState("Team lead"),
    [reset, setReset] = useState(false),
    [audioFile, setAudioFile] = useState<File>(),
    [audioConsent, setAudioConsent] = useState(false);
  const submissions = useRef(new ReportSubmissions());
  const audioSubmission = useRef<{ file: File; speaker: string; id: string } | undefined>(undefined);
  const [reportNotice, setReportNotice] = useState("");
  const acceptIncident = useCallback((incoming: Incident) => {
    setState(current => latestIncident(current, incoming));
  }, []);
  const busy = operation;
  const partnerEvidence = sponsorEvidence(state);
  useEffect(() => { document.body.classList.toggle("presenting", presenting); const exit = (e: KeyboardEvent) => { if (e.key === "Escape") setPresenting(false); }; window.addEventListener("keydown", exit); return () => window.removeEventListener("keydown", exit); }, [presenting]);
  useEffect(() => {
    request("/health")
      .then(setHealth)
      .catch((e) => setError(e.message));
    const stream = new EventSource(`/api/incidents/${incidentId}/events`);
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.addEventListener("incident", (e) =>
      acceptIncident(JSON.parse((e as MessageEvent).data)),
    );
    return () => stream.close();
  }, []);
  const draft = state?.handovers.at(-1),
    briefing = state?.briefings.at(-1);
  useEffect(() => setReviewed(false), [draft?.id, state?.version]);
  async function uploadAudio() {
    if (!audioFile || !audioConsent) return;
    if (audioFile.size > 8 * 1024 * 1024) {
      setError("Choose an audio file no larger than 8 MiB.");
      return;
    }
    const formats: Record<string, string> = {
      wav: "audio/wav",
      mp3: "audio/mpeg",
      m4a: "audio/mp4",
      mp4: "audio/mp4",
      webm: "audio/webm",
      ogg: "audio/ogg",
      flac: "audio/flac",
    };
    const contentType =
      audioFile.type ||
      formats[audioFile.name.split(".").at(-1)?.toLowerCase() ?? ""];
    if (!contentType) {
      setError("Choose WAV, MP3, M4A, WebM, Ogg or FLAC audio.");
      return;
    }
    if (audioSubmission.current?.file !== audioFile || audioSubmission.current.speaker !== speaker) {
      audioSubmission.current = {file: audioFile, speaker, id: crypto.randomUUID()};
    }
    const clientEventId = audioSubmission.current.id;
    setBusy("Saving selected audio…");
    setError("");
    const start = performance.now();
    try {
      const query = new URLSearchParams({
        incidentId,
        speaker,
        consent: "send-to-deepgram",
        clientEventId,
      });
      const response = await fetch(`/api/audio/observations?${query}`, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: audioFile,
        signal: AbortSignal.timeout(120000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Audio upload failed.");
      audioSubmission.current = undefined;
      setReportNotice("Audio saved. Transcription and AI continue in the background.");
      acceptIncident(result);
      setLatency(Math.round(performance.now() - start));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function act(label: string, path: string, body: unknown) {
    setBusy(label);
    setError("");
    const start = performance.now();
    try {
      const next = await request(path, body);
      acceptIncident(next);
      setLatency(Math.round(performance.now() - start));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }
  async function observe(speaker: string, text: string) {
    const report = submissions.current.prepare(incidentId, speaker, text);
    setReportNotice("Saving report…");
    const saved = await act("Saving report and updating mission", "/observations", report);
    if (saved) submissions.current.confirm(report);
    setReportNotice(saved ? "Report saved. AI updates will appear automatically." : "Save not confirmed. Retry the same report; it will only be added once.");
    return saved;
  }
  const active = state?.issues.filter((i) => i.status !== "resolved") ?? [],
    resolved = state?.issues.filter((i) => i.status === "resolved") ?? [];
  const hazards = active.filter(
      (i) => i.topic === "smoke" || i.topic === "rear-entrance",
    ),
    questions = active.filter(
      (i) =>
        i.topic === "occupant" ||
        i.topic === "other" ||
        i.status === "conflicting",
    );
  return (
    <>
      <div className="simulation">
        SIMULATED EMERGENCY · Service requests need approval · No emergency services
        connected
      </div>
      <header>
        <a className="brand" href="/" aria-label="Relay home">
          <span className="brand-icon">✳</span>
          <span>
            RELAY <b>MISSION ORCHESTRATOR</b>
          </span>
        </a>
        <span className={`connection ${connected ? "online" : ""}`}>
          <i />
          {connected ? "Live incident feed" : "Reconnecting…"}
        </span>
        <button className="presentation-toggle secondary" onClick={() => setPresenting(v => !v)}>{presenting ? "Exit presentation" : "Presentation mode"}</button>
      </header>
      <main>
        <form className="mission-switch" onSubmit={e => {
          e.preventDefault();
          const next = missionDraft.trim();
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(next)) { setError("Use 1–64 letters, numbers, hyphens or underscores for the mission ID."); return; }
          if (voiceActive || bandActive || operation || text.trim()) return;
          const destination = new URL(window.location.href); destination.search = new URLSearchParams({incidentId: next}).toString(); destination.hash = "";
          window.location.assign(destination);
        }}>
          <label htmlFor="mission-id">Mission ID</label>
          <input id="mission-id" value={missionDraft} onChange={e => {setMissionDraft(e.target.value);setLinkStatus("");}} pattern="[a-zA-Z0-9_\-]{1,64}" maxLength={64} required disabled={voiceActive || bandActive || !!operation} aria-describedby="mission-link-status" />
          <button className="secondary" type="submit" disabled={voiceActive || bandActive || !!operation || !!text.trim() || !missionDraft.trim()}>Open mission ↗</button>
          <button className="text-button" type="button" disabled={voiceActive || !!operation} onClick={async () => {
            const url = new URL(window.location.href);url.search = new URLSearchParams({incidentId}).toString();url.hash = "";
            try { await navigator.clipboard.writeText(url.toString());setLinkStatus("Current mission link copied."); }
            catch { setLinkStatus("Copy unavailable here. The current mission URL is in the address bar."); }
          }}>Copy mission link</button>
          <span id="mission-link-status" role="status">{linkStatus || (bandActive ? "Stop band listening and finish pending reports before changing missions." : voiceActive ? "Stop capture before changing missions." : text.trim() ? "Send or clear the typed report before switching." : "Use the same ID to share context on this server.")}</span>
        </form>
        <section className="intro">
          <div>
            <p className="eyebrow">
              TEAM LEAD WORKSPACE / {incidentId.toUpperCase()}
            </p>
            <h1>Every report. One shared mission.</h1>
            <p className="muted">
              Vexo captures the report. Relay connects the context, updates the team, and prepares the next action.
            </p>
          </div>
          <div className="mode">
            <span className="eyebrow">MISSION REASONING</span>
            <strong>
              {health?.mode === "gemini"
                ? "Gemini extraction + coordination"
                : "Deterministic demo"}
            </strong>
            <small>
              {health?.mode === "gemini"
                ? "Live Gemini · evidence-linked actions"
                : "Scenario rules · no AI API calls"}
            </small>
          </div>
        </section>
        <nav className="mission-flow" aria-label="How this mission works">
          <a href="#band-input"><b>01</b><strong>Listen</strong><span>Vexo band → this mission</span></a>
          <a href="#shared-picture"><b>02</b><strong>Build the shared picture</strong><span>{state?.observations.length ?? 0} reports · {hazards.length} active hazards · {questions.length} open questions</span></a>
          <a href="#mission-actions"><b>03</b><strong>Coordinate the response</strong><span>{state?.actions?.filter(a => a.status === "proposed").length ?? 0} requests to review · {state?.actions?.filter(a => a.status === "acknowledged").length ?? 0} acknowledged</span></a>
        </nav>
        <div className="status" role="status">
          {busy ||
            (!connected
              ? "Waiting for backend connection…"
              : voiceActive ? "Mission listening is active · dispatcher controls remain available" : "Ready for an observation")}
          <span>Shared context → coordinator → actions → acknowledgments</span>
        </div>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <MissionSourceStatus missionId={incidentId} />
        {health && !health.missionSource && <BandListening incidentId={incidentId} speaker={speaker} onSpeaker={setSpeaker} onActive={setBandActive} externalBusy={voiceActive || !!operation} />}
        <details className="input-alternative" open={voiceActive || undefined} onToggle={e => { if (voiceActive) e.currentTarget.open = true; }}>
          <summary>Laptop microphone & spoken briefing{voiceActive ? " · session active" : ""}</summary>
        <VoiceConsole incidentId={incidentId} incident={state} speaker={speaker} onSpeaker={setSpeaker}
          gemini={!!health?.voice.gemini.configured} deepgram={!!health?.voice.deepgram.configured} minimax={!!health?.voice.minimax.configured}
          mode={health?.mode} externalBusy={!!operation || bandActive} onIncident={acceptIncident} onActive={setVoiceActive} />
        </details>
        <ReportProgress incident={state} act={act} />
        <div className="workspace">
          <div className="primary">
            <div id="mission-actions"><MissionActions incident={state} busy={!!operation} connected={connected} act={act} /></div>
            {!health?.missionTestExecution && <TestDispatch missionId={incidentId} />}
            <section className="panel timeline-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">01 / INCIDENT RECORDER</p>
                  <h2>Live timeline</h2>
                </div>
                <span className="chip">SOURCE PRESERVED</span>
              </div>
              {!state?.observations.length ? (
                <div className="empty">
                  <span>◎</span>
                  <h3>Waiting for the first report</h3>
                  <p>
                    Start band listening, type a report below, or open the sample reports at the bottom.
                  </p>
                </div>
              ) : (
                <ol className="timeline">
                  {state.observations.map((o, n) => (
                    <li key={o.id} id={`observation-${o.id}`}>
                      <span className="timeline-number">
                        {String(n + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <div className="observation-meta">
                          <strong>{o.speaker}</strong>
                          <time>{time(o.timestamp)}</time>
                        </div>
                        <p>{o.text}</p>
                        <div className="tags">
                          {o.facts.map((f, i) => (
                            <span key={i}>
                              {f.source === "resident"
                                ? "Resident report"
                                : "Responder report"}
                              {f.uncertain ? " · unconfirmed" : ""}
                            </span>
                          ))}
                          <small>
                            {o.inputKind} · {o.mode} · {" "}
                            {o.processing && o.processing !== "complete" ? `Saved · ${o.processing}` : `${o.processingMs} ms ${o.processing ? "total" : "extraction"}`}
                          </small>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section className="panel input-panel">
              <p className="eyebrow">RESPONDER INPUT / TYPED BACKUP</p>
              <h2>Add an observation</h2>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await observe(speaker, text)) setText("");
                }}
              >
                <label>
                  Speaker
                  <select
                    disabled={!!busy}
                    value={speaker}
                    onChange={(e) => setSpeaker(e.target.value)}
                  >
                    <option>Firefighter A</option>
                    <option>Firefighter B</option>
                    <option>911 Dispatcher</option><option>Police Officer</option><option>EMS Paramedic</option><option>Team lead</option>
                  </select>
                </label>
                <label>
                  Report
                  <textarea
                    disabled={!!busy}
                    placeholder="What do you observe? Include who reported it."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={4000}
                    required
                  />
                </label>
                <button disabled={!!busy || !text.trim()} type="submit">
                  Save report <span>↗</span>
                </button>
              </form>
              {reportNotice && <p className="small muted" role="status">{reportNotice}</p>}
              <p className="small muted">
                Typed reports and microphone transcripts update this same incident record.
              </p>
              <details className="voice-upload"><summary>Upload a prerecorded report</summary>
                <h3>Audio file → Deepgram</h3>
                <p className="small muted">
                  {!health
                    ? "Checking provider configuration…"
                    : health.voice.deepgram.configured
                      ? "Backend configured · availability checked on request"
                      : "Not configured · set DEEPGRAM_API_KEY on the backend"}
                </p>
                <label>
                  Single-speaker audio file (up to 8 MiB)
                  <input
                    type="file"
                    accept="audio/wav,audio/mpeg,audio/mp4,audio/webm,audio/ogg,audio/flac,.wav,.mp3,.m4a,.webm,.ogg,.flac"
                    onChange={(e) => {
                      setAudioFile(e.target.files?.[0]);
                      setAudioConsent(false);
                    }}
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={audioConsent}
                    onChange={(e) => setAudioConsent(e.target.checked)}
                  />
                  Send this selected recording to Deepgram and record its
                  transcript under {speaker}. Everyone recorded agreed to this
                  use.
                </label>
                <button
                  className="secondary"
                  disabled={
                    !!busy ||
                    !audioFile ||
                    !audioConsent ||
                    !health?.voice.deepgram.configured
                  }
                  onClick={uploadAudio}
                >
                  Transcribe file and record observation
                </button>
                <p className="small muted">
                  No microphone capture. One speaker per file; review the
                  resulting transcript. Empty or low-confidence results are
                  rejected.
                </p>
              </details>
            </section>
          </div>
          <aside>
            <section id="shared-picture" className="panel situation-panel">
              <p className="eyebrow">SHARED MISSION CONTEXT</p>
              <h2>Current picture</h2>
              <h3 className="subheading">Active hazards</h3>
              {hazards.length ? (
                hazards.map((i) => <IssueCard key={i.id} issue={i} />)
              ) : (
                <p className="small muted">
                  No hazards reported. This does not establish safety.
                </p>
              )}
              <h3 className="subheading">
                Unresolved questions & contradictions
              </h3>
              {questions.length ? (
                questions.map((i) => <IssueCard key={i.id} issue={i} />)
              ) : (
                <p className="small muted">No open questions recorded.</p>
              )}
              {resolved.length > 0 && (
                <>
                  <h3 className="subheading">Resolved reports</h3>
                  {resolved.map((i) => (
                    <IssueCard key={i.id} issue={i} />
                  ))}
                </>
              )}
            </section>
            <section className="panel briefing">
              <p className="eyebrow">03 / BRIEFING AGENT</p>
              <h2>Latest briefing</h2>
              {briefing ? (
                <>
                  <p className="briefing-text">{briefing.text}</p>
                  <p className="small muted">
                    Revision {briefing.revision} · {time(briefing.timestamp)}
                    {briefing.stateVersion !== state?.version
                      ? " · Outdated — request an update"
                      : ""}
                  </p>
                </>
              ) : (
                <p className="muted small">
                  Request a recap of the current evidence. Briefings never imply
                  independently verified facts.
                </p>
              )}
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() =>
                  act("Preparing briefing", "/briefings", { incidentId })
                }
              >
                {briefing
                  ? "Update my briefing"
                  : "Give me the latest briefing"}
              </button>
              {briefing && <button className="text-button" disabled={briefing.stateVersion !== state?.version} onClick={() => {
                const content = ["RELAY / INCIDENT BRIEFING", "Prepared by Relay software from attributed reports.", briefing.text,
                  "SOURCE REPORTS", ...state!.observations.map(o => `[${time(o.timestamp)}] ${o.speaker}: ${o.text}`)].join("\n\n");
                const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
                const link = document.createElement("a"); link.href = url; link.download = `relay-${incidentId}-briefing.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}>Download current briefing</button>}
            </section>
            <section className="panel">
              <p className="eyebrow">HUMAN REVIEW</p>
              <h2>Team handover</h2>
              <button
                className="secondary"
                disabled={!!busy || !state?.observations.length}
                onClick={() =>
                  act("Preparing handover draft", "/handovers", { incidentId })
                }
              >
                Prepare handover
              </button>
              {draft && !draft.approvedAt && (
                <div className="draft">
                  <span className="chip">DRAFT · NOT SHARED</span>
                  <p>{draft.text}</p>
                  {draft.stateVersion !== state?.version ? (
                    <p className="error small">
                      Incident changed. Prepare a fresh draft.
                    </p>
                  ) : (
                    <>
                      <label>
                        Reviewer
                        <input
                          value={lead}
                          onChange={(e) => setLead(e.target.value)}
                          maxLength={80}
                        />
                      </label>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={reviewed}
                          onChange={(e) => setReviewed(e.target.checked)}
                        />
                        I reviewed this draft against the incident evidence.
                      </label>
                      <button
                        disabled={!!busy || !reviewed || !lead.trim()}
                        onClick={() =>
                          act(
                            "Approving to simulated feed",
                            `/handovers/${draft.id}/approve`,
                            {
                              incidentId,
                              approvedBy: lead,
                              expectedVersion: state!.version,
                            },
                          )
                        }
                      >
                        Approve to simulated feed
                      </button>
                    </>
                  )}
                </div>
              )}
              <h3 className="subheading">Simulated team feed</h3>
              {state?.handovers
                .filter((h) => h.approvedAt)
                .map((h) => (
                  <article className="feed-item" key={h.id}>
                    <strong>Approved by {h.approvedBy}</strong>
                    <p>{h.text}</p>
                    <small>
                      {time(h.approvedAt!)}
                      {h.stateVersion !== state.version
                        ? " · Historical snapshot"
                        : ""}
                    </small>
                  </article>
                ))}
              {!state?.handovers.some((h) => h.approvedAt) && (
                <p className="small muted">
                  Nothing shared. Approval stays in this local simulation.
                </p>
              )}
            </section>
          </aside>
        </div>
            <details className="panel scenario">
              <summary>Try sample reports</summary>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">REHEARSAL CONTROLS</p>
                  <h2>One incident. Four roles.</h2>
                </div>
                <button
                  className="text-button"
                  disabled={!!busy || voiceActive}
                  onClick={() => setReset(true)}
                >
                  Reset simulation
                </button>
              </div>
              <p className="small muted">
                Each report updates this mission and its action queue. Service requests require dispatcher approval.
              </p>
              <div className="scenario-steps">
                {[...scenario.map((report, i) => ({...report, title: ["Smoke + possible occupant", "Rear entrance blocked", "Resident locates missing person"][i]})),
                  {speaker: "911 Dispatcher", title: "Request EMS support", text: "Request an ambulance for two injured people."},
                  {speaker: "Police Officer", title: "Request traffic support", text: "Request police for traffic control. The road is blocked."},
                  {speaker: "EMS Paramedic", title: "EMS provides a field update", text: "EMS on scene. Two people report injuries. We are checking their condition."}
                ].map((s, i) => (
                  <button key={i} className="scenario-button" disabled={!!busy || !connected}
                    onClick={() => observe(s.speaker, s.text)}>
                    <span>0{i + 1}</span><div><strong>{s.title}</strong><small>{s.speaker}</small></div><b>+</b>
                  </button>
                ))}
              </div>
              {reset && (
                <div className="reset-confirm">
                  <p>
                    Erase this simulated incident’s timeline, briefings and
                    handovers?
                  </p>
                  <button
                    className="danger"
                    disabled={!!busy || voiceActive}
                    onClick={async () => {
                      if (
                        await act(
                          "Resetting simulation",
                          `/incidents/${incidentId}/reset`,
                          { confirm: "RESET SIMULATION" },
                        )
                      )
                        setReset(false);
                    }}
                  >
                    Erase simulation
                  </button>
                  <button className="secondary" onClick={() => setReset(false)}>
                    Cancel
                  </button>
                </div>
              )}
            </details>
        <details className="panel tools-panel">
          <summary>Connected tools and evidence</summary>
        <div className="integration-strip" aria-label="Integration status">
          <a href="#sponsor-heading"><strong>Google Gemini</strong><small>{partnerEvidence.geminiCount ? `${partnerEvidence.geminiCount} saved extractions · inspect results ↗` : health?.mode === "gemini" ? "Live extraction enabled · awaiting report" : "Scenario rules · no extraction yet"}</small></a>
          <a href="#sponsor-heading"><strong>Vexo</strong><small>{partnerEvidence.vexoPhysical ? `Band ${partnerEvidence.vexoPhysical.sourceDevice!.bandNumber} · ${partnerEvidence.vexoPhysicalCount} recorded reports ↗` : partnerEvidence.vexoCount ? `${partnerEvidence.vexoCount} simulator reports · inspect source ↗` : "No physical-band reports in this mission"}</small></a>
          <span><strong>Speech loop</strong><small>{health?.voice.gemini.configured ? "Gemini audio configured" : "Browser speech available where supported"}</small></span>
          <span><strong>Service execution</strong><small>Simulated connectors · dispatcher approval</small></span>
        </div>

          <SponsorEvidence incident={state} mode={health?.mode} connected={connected} />
        </details>
        <footer>
          RELAY / MISSION CONTROL{" "}
          <span>
            Vexo hackathon prototype · Sources stay attached. Humans stay in
            charge.
          </span>
        </footer>
      </main>
    </>
  );
}
function IssueCard({ issue }: { issue: Issue }) {
  const last = issue.evidence.at(-1)!;
  return (
    <article className={`issue ${issue.status}`}>
      <div className="issue-title">
        <strong>{issue.label}</strong>
        <span>
          {issue.status === "resolved"
            ? "RESOLVED REPORT"
            : issue.status === "conflicting"
              ? "CONFLICT"
              : "REPORTED"}
        </span>
      </div>
      <p>
        {issue.status === "resolved"
          ? `Resolved according to ${last.source} · not independently confirmed`
          : issue.uncertain
            ? "Unconfirmed · preserve uncertainty"
            : "Responder report · not independently verified"}
      </p>
      <small>
        {last.source} · {time(last.timestamp)}
      </small>
      <details>
        <summary>
          {issue.evidence.length} source{" "}
          {issue.evidence.length === 1 ? "entry" : "entries"}
        </summary>
        {issue.evidence.map((e, i) => (
          <p key={i} className="evidence">
            {e.source} · {e.status}
            <br />
            {e.label} · {time(e.timestamp)} <a href={`#observation-${e.observationId}`}>View source ↗</a>
          </p>
        ))}
      </details>
    </article>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
