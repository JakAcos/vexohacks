import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { scenario, type Incident, type Issue } from "../shared/model";
import "./style.css";
type Health = {
  mode: "demo" | "gemini";
  roles: Record<string, string>;
  voice: {
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
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [speaker, setSpeaker] = useState("Firefighter A"),
    [text, setText] = useState(""),
    [latency, setLatency] = useState<number>(),
    [reviewed, setReviewed] = useState(false),
    [lead, setLead] = useState("Team lead"),
    [reset, setReset] = useState(false),
    [audioFile, setAudioFile] = useState<File>(),
    [audioConsent, setAudioConsent] = useState(false),
    [audioUrl, setAudioUrl] = useState<string>();
  useEffect(() => {
    request("/health")
      .then(setHealth)
      .catch((e) => setError(e.message));
    const stream = new EventSource(`/api/incidents/${incidentId}/events`);
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.addEventListener("incident", (e) =>
      setState(JSON.parse((e as MessageEvent).data)),
    );
    return () => stream.close();
  }, []);
  const draft = state?.handovers.at(-1),
    briefing = state?.briefings.at(-1);
  useEffect(() => setReviewed(false), [draft?.id, state?.version]);
  useEffect(() => setAudioUrl(undefined), [briefing?.id, state?.version]);
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );
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
    setBusy("Sending selected file to Deepgram → recording transcript");
    setError("");
    const start = performance.now();
    try {
      const query = new URLSearchParams({
        incidentId,
        speaker,
        consent: "send-to-deepgram",
      });
      const response = await fetch(`/api/audio/observations?${query}`, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: audioFile,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Audio upload failed.");
      setState(result);
      setLatency(Math.round(performance.now() - start));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function generateAudio() {
    if (!briefing) return;
    setBusy("Generating MiniMax briefing audio");
    setError("");
    setAudioUrl(undefined);
    const start = performance.now();
    try {
      const response = await fetch("/api/briefings/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, briefingId: briefing.id }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "MiniMax audio failed.");
      }
      setAudioUrl(URL.createObjectURL(await response.blob()));
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
      setState(next);
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
    return act("Recording → tracking incident", "/observations", {
      incidentId,
      speaker,
      text,
    });
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
        SIMULATED EMERGENCY · Human decisions only · No emergency services
        connected
      </div>
      <header>
        <a className="brand" href="/" aria-label="First Responder Copilot home">
          <span className="brand-icon">✳</span>
          <span>
            FIRST RESPONDER <b>COPILOT</b>
          </span>
        </a>
        <span className={`connection ${connected ? "online" : ""}`}>
          <i />
          {connected ? "Live incident feed" : "Reconnecting…"}
        </span>
      </header>
      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">
              TEAM LEAD WORKSPACE / {incidentId.toUpperCase()}
            </p>
            <h1>Keep the whole picture.</h1>
            <p className="muted">
              Apartment building <span> / </span> Smoke assessment
            </p>
          </div>
          <div className="mode">
            <span className="eyebrow">PROCESSING MODE</span>
            <strong>
              {health?.mode === "gemini"
                ? "Gemini extraction"
                : "Deterministic demo"}
            </strong>
            <small>
              {health?.mode === "gemini"
                ? "Live API · rule-based tracker & briefing"
                : "Scenario rules · no AI API calls"}
            </small>
          </div>
        </section>
        <section className="metrics">
          <div>
            <span>OBSERVATIONS</span>
            <strong>{state?.observations.length ?? 0}</strong>
          </div>
          <div>
            <span>ACTIVE HAZARDS</span>
            <strong>{hazards.length}</strong>
          </div>
          <div>
            <span>OPEN QUESTIONS / CONFLICTS</span>
            <strong>{questions.length}</strong>
          </div>
          <div>
            <span>LAST REQUEST ROUND TRIP</span>
            <strong>{latency === undefined ? "—" : `${latency} ms`}</strong>
            <small>Measured in this browser</small>
          </div>
        </section>
        <div className="status" role="status">
          {busy ||
            (!connected
              ? "Waiting for backend connection…"
              : "Ready for an observation")}
          <span>Recorder → situation tracker → requested briefing</span>
        </div>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <div className="workspace">
          <div className="primary">
            <section className="panel">
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
                    Send a responder observation or start the staged scenario
                    below.
                  </p>
                </div>
              ) : (
                <ol className="timeline">
                  {state.observations.map((o, n) => (
                    <li key={o.id}>
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
                            {o.inputKind} · {o.mode} · extraction{" "}
                            {o.processingMs} ms
                          </small>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section className="panel input-panel">
              <p className="eyebrow">RESPONDER INPUT / TEXT BRIDGE</p>
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
                    value={speaker}
                    onChange={(e) => setSpeaker(e.target.value)}
                  >
                    <option>Firefighter A</option>
                    <option>Firefighter B</option>
                  </select>
                </label>
                <label>
                  Report
                  <textarea
                    placeholder="What do you observe? Include who reported it."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={4000}
                    required
                  />
                </label>
                <button disabled={!!busy || !text.trim()} type="submit">
                  Record observation <span>↗</span>
                </button>
              </form>
              <p className="small muted">
                Typed text now. Vexo transcripts can use the same backend
                endpoint.
              </p>
              <div className="voice-upload">
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
              </div>
            </section>
            <section className="panel scenario">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">REHEARSAL CONTROLS</p>
                  <h2>The two-minute scenario</h2>
                </div>
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() => setReset(true)}
                >
                  Reset simulation
                </button>
              </div>
              <p className="small muted">
                Start with an empty incident. Each button submits a real backend
                request.
              </p>
              <div className="scenario-steps">
                {scenario.map((s, i) => (
                  <button
                    key={i}
                    className="scenario-button"
                    disabled={!!busy}
                    onClick={() => observe(s.speaker, s.text)}
                  >
                    <span>0{i + 1}</span>
                    <div>
                      <strong>
                        {
                          [
                            "Smoke + possible occupant",
                            "Rear entrance blocked",
                            "Resident locates missing person",
                          ][i]
                        }
                      </strong>
                      <small>{s.speaker}</small>
                    </div>
                    <b>+</b>
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
                    disabled={!!busy}
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
            </section>
          </div>
          <aside>
            <section className="panel">
              <p className="eyebrow">02 / SITUATION TRACKER</p>
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
              {briefing && (
                <button
                  className="text-button"
                  onClick={() => {
                    if (!("speechSynthesis" in window)) {
                      setError("Browser speech playback is unavailable.");
                      return;
                    }
                    window.speechSynthesis.cancel();
                    const speech = new SpeechSynthesisUtterance(briefing.text);
                    speech.onerror = () =>
                      setError(
                        "Browser speech playback failed. Written briefing remains available.",
                      );
                    window.speechSynthesis.speak(speech);
                  }}
                >
                  ▷ Read aloud on this computer
                </button>
              )}
              <p className="small muted">
                Browser speech only · not MiniMax or band playback
              </p>
              <div className="voice-output">
                <h3>MiniMax briefing audio</h3>
                <p className="small muted">
                  {!health
                    ? "Checking provider configuration…"
                    : health.voice.minimax.configured
                      ? "Backend configured · availability checked on request"
                      : "Not configured · set backend MiniMax key, model and voice"}
                </p>
                <button
                  className="secondary"
                  disabled={
                    !!busy ||
                    !health?.voice.minimax.configured ||
                    !briefing ||
                    briefing.stateVersion !== state?.version
                  }
                  onClick={generateAudio}
                >
                  Generate MiniMax audio
                </button>
                <p className="small muted">
                  Generation sends the current briefing text to MiniMax. Play
                  the returned audio on this computer; no band speaker is used.
                </p>
                {audioUrl && (
                  <audio
                    aria-label="MiniMax briefing playback"
                    controls
                    src={audioUrl}
                    onError={() =>
                      setError(
                        "Returned MiniMax audio could not be played. The written briefing remains available.",
                      )
                    }
                  />
                )}
              </div>
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
        <footer>
          FIRST RESPONDER COPILOT{" "}
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
            {e.label} · {time(e.timestamp)}
          </p>
        ))}
      </details>
    </article>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
