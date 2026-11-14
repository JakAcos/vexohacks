import React, { useEffect, useRef, useState } from "react";
import { AudioSegments } from "../shared/continuous-audio";
import { latestIncident } from "../shared/mission-sync";
import type { Incident } from "../shared/model";

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  start(): void; stop(): void; abort(): void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
type Props = {
  incidentId: string; incident?: Incident; speaker: string; onSpeaker: (s: string) => void;
  deepgram: boolean; minimax: boolean; gemini: boolean; mode?: string; externalBusy: boolean;
  onIncident: (incident: Incident) => void; onActive: (active: boolean) => void;
};
type Turn = { kind: "observation" | "briefing" | "queued"; jobId?: string; transcript: string; incident: Incident };
async function jsonRequest(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
export function VoiceConsole(props: Props) {
  const [awaitingJobs, setAwaitingJobs] = useState<Record<string, number>>({});
  const handledJobs = useRef(new Set<string>());
  const [voiceSpeaker, setVoiceSpeaker] = useState(props.speaker);
  const voiceSpeakerRef = useRef(voiceSpeaker); voiceSpeakerRef.current = voiceSpeaker;
  const Speech = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
  const [input, setInput] = useState<"browser" | "deepgram" | "gemini">("browser");
  const [output, setOutput] = useState<"browser" | "minimax" | "gemini">("browser");
  const [recording, setRecording] = useState(false), [starting, setStarting] = useState(false);
  const [pending, setPending] = useState(0), [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("Ready for a spoken report"), [error, setError] = useState("");
  const [interim, setInterim] = useState(""), [last, setLast] = useState(""), [elapsed, setElapsed] = useState<number>();
  const [consent, setConsent] = useState(false), [session, setSession] = useState(false), [gaps, setGaps] = useState<string[]>([]), [level, setLevel] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const failedJobs = useRef<(() => Promise<void>)[]>([]);
  const wanted = useRef(false), pendingCount = useRef(0), captureContext = useRef<AudioContext | null>(null);
  const captureNode = useRef<AudioWorkletNode | null>(null), segmenter = useRef<AudioSegments | null>(null);
  const flushResolve = useRef<(() => void) | null>(null), resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopping = useRef(false), busyReadout = useRef(false), retryCount = useRef(0), initializedProvider = useRef(false);
  const latest = useRef(props); latest.current = props;
  const recognition = useRef<Recognition | null>(null);
  const stream = useRef<MediaStream | null>(null), audio = useRef<HTMLAudioElement | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const queue = useRef(Promise.resolve());
  const generation = useRef(0), mounted = useRef(true), readVersion = useRef<number | undefined>(undefined);
  const stopResolve = useRef<(() => void) | null>(null), stopPromise = useRef<Promise<void> | null>(null);
  const finalText = useRef<string[]>([]), finalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackDone = useRef<(() => void) | null>(null);
  const active = session || recording || starting || pending > 0 || playing;
  useEffect(() => { props.onActive(active || failedCount > 0); }, [active, failedCount]);
  useEffect(() => { if (props.gemini && !initializedProvider.current && !active) { setInput("gemini"); setOutput("gemini"); initializedProvider.current = true; } }, [props.gemini]);
  useEffect(() => {
    if (readVersion.current !== undefined && props.incident && props.incident.version !== readVersion.current) {
      cancelPlayback(); setStatus("Incident changed. Request a fresh briefing.");
    }
  }, [props.incident?.version]);
  useEffect(() => () => {
    mounted.current = false; wanted.current = false; generation.current++;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    captureNode.current?.disconnect(); void captureContext.current?.close();
    if (finalTimer.current) clearTimeout(finalTimer.current);
    if (recognition.current) { recognition.current.onresult = null; recognition.current.onend = null; recognition.current.abort(); }
    stream.current?.getTracks().forEach(t => t.stop());
    cancelPlayback();
  }, []);
  useEffect(() => {
    for (const [jobId, started] of Object.entries(awaitingJobs)) {
      const job = props.incident?.reportJobs?.find(j => j.id === jobId);
      if (!job || handledJobs.current.has(jobId)) continue;
      if (job.status === "failed") { setStatus("Audio saved · processing failed. Retry the saved report below."); continue; }
      if (job.status !== "complete") continue;
      handledJobs.current.add(jobId);
      setAwaitingJobs(current => { const next = { ...current }; delete next[jobId]; return next; });
      const observation = props.incident?.observations.find(o => o.id === job.observationId);
      const command = props.incident?.voiceCommands.find(c => c.briefingId === job.briefingId);
      void handleTurn({kind: job.briefingId ? "briefing" : "observation", transcript: observation?.text ?? command?.transcript ?? "", incident: props.incident!}, started).catch(fail);
    }
  }, [props.incident?.revision, awaitingJobs]);
  function cancelPlayback() {
    if (audio.current) { audio.current.pause(); URL.revokeObjectURL(audio.current.src); audio.current = null; }
    if (utterance.current) { window.speechSynthesis?.cancel(); utterance.current = null; }
    playbackDone.current?.(); playbackDone.current = null; readVersion.current = undefined;
    if (mounted.current) setPlaying(false);
  }
  function fail(e: unknown) {
    if (!mounted.current) return;
    wanted.current = false; busyReadout.current = false; setSession(false); void stopCapture();
    setGaps(g => [...g.slice(-19), `${new Date().toLocaleTimeString()}: processing failed; review the last transcript and timeline.`]);
    setError(e instanceof Error ? e.message : String(e));
    setStatus("Stopped · review the message before retrying");
  }
  function enqueue(task: () => Promise<void>) {
    pendingCount.current++; setPending(n => n + 1);
    queue.current = queue.current.then(task).catch(e => { failedJobs.current.push(task); setFailedCount(failedJobs.current.length); fail(e); }).finally(() => { pendingCount.current--; if (mounted.current) setPending(n => n - 1); });
  }
  async function playBriefing(state: Incident) {
    if (latestIncident(latest.current.incident, state) !== state) throw new Error("Newer mission information is available. Request a fresh briefing.");
    const briefing = state.briefings.at(-1);
    if (!briefing || briefing.stateVersion !== state.version) throw new Error("Request a fresh briefing first.");
    cancelPlayback(); readVersion.current = state.version;
    setStatus(output !== "browser" ? `Generating speech with ${output}…` : "Reading briefing · browser voice");
    setPlaying(true);
    try {
      if (output !== "browser") {
        const response = await fetch("/api/briefings/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ incidentId: props.incidentId, briefingId: briefing.id, provider: output }), signal: AbortSignal.timeout(35000) });
        if (!response.ok) throw new Error((await response.json()).error || "Speech generation failed.");
        const blob = await response.blob();
        if (readVersion.current !== state.version || latest.current.incident?.version !== state.version) throw new Error("Incident changed. Request a fresh briefing.");
        const player = new Audio(URL.createObjectURL(blob)); audio.current = player;
        setStatus(`Reading briefing · ${output} audio`);
        await new Promise<void>((resolve, reject) => { playbackDone.current = resolve; player.onended = () => resolve(); player.onerror = () => reject(new Error("Audio playback failed.")); player.play().catch(() => reject(new Error("Browser blocked playback. Click Request and read briefing to try again."))); });
      } else {
        if (!("speechSynthesis" in window)) throw new Error("Browser speech playback is unavailable. Use the written briefing.");
        await new Promise<void>((resolve, reject) => {
          const speech = new SpeechSynthesisUtterance(briefing.text); utterance.current = speech;
          speech.lang = "en-US"; speech.rate = 1;
          playbackDone.current = resolve; speech.onend = () => resolve();
          speech.onerror = event => event.error === "canceled" || event.error === "interrupted" ? resolve() : reject(new Error(`Browser playback: ${event.error}`));
          window.speechSynthesis.speak(speech);
        });
      }
      if (readVersion.current === state.version) setStatus("Briefing complete · resuming active session");
    } finally { cancelPlayback(); }
  }
  async function handleTurn(turn: Turn, started: number) {
    if (!mounted.current) return;
    if (turn.kind === "queued") {
      props.onIncident(turn.incident);
      if (turn.jobId) setAwaitingJobs(current => ({ ...current, [turn.jobId!]: started }));
      setStatus("Audio saved · transcription and AI continue in the background");
      return;
    }
    setLast(turn.transcript); props.onIncident(turn.incident);
    // Keep the fresh snapshot available before React's next render.
    const current = latestIncident(latest.current.incident, turn.incident);
    latest.current = { ...latest.current, incident: current };
    setElapsed(Math.round(performance.now() - started));
    if (turn.kind === "briefing") {
      if (current !== turn.incident) { setStatus("Newer mission information is available. Request a fresh briefing."); return; }
      busyReadout.current = true;
      await stopCapture();
      setGaps(g => [...g.slice(-19), `${new Date().toLocaleTimeString()}: capture paused for briefing playback.`]);
      try { await playBriefing(turn.incident); } finally { busyReadout.current = false; resumeCapture(); }
    } else setStatus("Report saved · AI updates appear automatically");
  }
  function submitFinal(text: string, speaker: string) {
    if (!text.trim()) return;
    setLast(text); setInterim("");
    const clientEventId = crypto.randomUUID();
    enqueue(async () => {
      setStatus("Saving spoken report…");
      const started = performance.now();
      const turn = await jsonRequest("/api/voice/turn", { incidentId: props.incidentId, speaker, text, clientEventId });
      await handleTurn(turn, started);
    });
  }
  function flushFinal(speaker = voiceSpeakerRef.current) {
    if (finalTimer.current) clearTimeout(finalTimer.current);
    finalTimer.current = null;
    const text = finalText.current.join(" ").trim(); finalText.current = [];
    if (text) submitFinal(text, speaker);
  }
  function resumeCapture() {
    if (!wanted.current || !mounted.current || busyReadout.current) return;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => { if (wanted.current && !recognition.current && !captureContext.current) void startCapture(true); }, 350);
  }
  async function endSession() {
    wanted.current = false; setSession(false); cancelPlayback();
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    await stopCapture(); setStatus("Session stopped");
  }
  async function stopCapture() {
    if (stopping.current) { if (stopPromise.current) await stopPromise.current; return; }
    stopping.current = true;
    generation.current++; setStarting(false);
    if (recognition.current) {
      if (!stopPromise.current) {
        stopPromise.current = new Promise<void>(resolve => { stopResolve.current = resolve; });
        try { recognition.current.stop(); } catch { recognition.current = null; stopResolve.current?.(); }
      }
      const timer = setTimeout(() => { if (recognition.current) { recognition.current.abort(); recognition.current = null; } flushFinal(); stopResolve.current?.(); }, 2500);
      await stopPromise.current; clearTimeout(timer); stopPromise.current = null; stopResolve.current = null;
    }
    if (captureNode.current) {
      const node = captureNode.current;
      let timer: ReturnType<typeof setTimeout>;
      await new Promise<void>(resolve => { flushResolve.current = resolve; node.port.postMessage("flush"); timer = setTimeout(resolve, 500); });
      clearTimeout(timer!); flushResolve.current = null;
      segmenter.current?.flush(); segmenter.current = null;
      node.port.onmessage = null; node.disconnect(); captureNode.current = null;
    }
    if (captureContext.current) { await captureContext.current.close(); captureContext.current = null; }
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
    setRecording(false); setInterim(""); setLevel(0); stopping.current = false;
  }
  async function startCapture(resuming = false) {
    if ((!resuming && (active || props.externalBusy)) || recognition.current || captureContext.current) return;
    if (!resuming) { wanted.current = true; setSession(true); retryCount.current = 0; }
    cancelPlayback(); setError(""); setStarting(true); setStatus(resuming ? "Resuming mission microphone…" : "Requesting microphone access…");
    const ownGeneration = ++generation.current, speaker = voiceSpeakerRef.current;
    try {
      if (input === "browser") {
        if (!Speech) throw new Error("Browser speech recognition is unsupported. Select Deepgram or type a report.");
        const service = new Speech(); recognition.current = service;
        service.lang = "en-US"; service.continuous = true; service.interimResults = true;
        const seen = new Set<number>();
        service.onstart = () => { if (ownGeneration !== generation.current) { service.abort(); return; } setStarting(false); setRecording(true); setStatus("Listening · browser speech service"); };
        service.onresult = event => {
          retryCount.current = 0;
          let provisional = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal && !seen.has(i)) { seen.add(i); finalText.current.push(result[0].transcript.trim()); }
            else if (!result.isFinal) provisional += result[0].transcript;
          }
          setInterim(provisional);
          if (finalText.current.length) { if (finalTimer.current) clearTimeout(finalTimer.current); finalTimer.current = setTimeout(() => flushFinal(speaker), 650); }
        };
        service.onerror = event => {
          if (event.error === "aborted") return;
          if (event.error === "no-speech" && wanted.current && retryCount.current++ < 3) { setStatus("Waiting for speech · reconnecting browser service"); return; }
          fail(new Error(`Microphone recognition: ${event.error}. ${event.error === "not-allowed" ? "Allow microphone access and try again." : "Select Gemini or use typed input if browser speech is unavailable."}`));
        };
        service.onend = () => { flushFinal(speaker); recognition.current = null; setStarting(false); setRecording(false); setInterim(""); stopResolve.current?.(); if (!stopping.current) resumeCapture(); };
        service.start();
      } else {
        if (!(input === "gemini" ? props.gemini : props.deepgram)) throw new Error("Selected speech service is not configured on the server.");
        if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) throw new Error("Microphone capture requires localhost or HTTPS in a supported browser.");
        const granted = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
        if (ownGeneration !== generation.current || !mounted.current || !wanted.current) { granted.getTracks().forEach(t => t.stop()); return; }
        stream.current = granted;
        const context = new AudioContext(); captureContext.current = context;
        await context.audioWorklet.addModule("/voice-capture.js");
        if (ownGeneration !== generation.current || !wanted.current) { await stopCapture(); return; }
        await context.resume();
        const source = context.createMediaStreamSource(granted), node = new AudioWorkletNode(context, "relay-capture"), mute = context.createGain();
        mute.gain.value = 0; source.connect(node); node.connect(mute); mute.connect(context.destination); captureNode.current = node;
        segmenter.current = new AudioSegments(context.sampleRate, bytes => {
          const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
          const clientEventId = crypto.randomUUID();
          const task = async () => {
            setStatus(`${input} transcribing → updating shared context…`); const started = performance.now();
            const query = new URLSearchParams({ incidentId: props.incidentId, speaker, clientEventId, provider: input, consent: `send-to-${input}` });
            const response = await fetch(`/api/voice/audio?${query}`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: blob, signal: AbortSignal.timeout(120000) });
            const turn = await response.json(); if (!response.ok) throw new Error(turn.error || "Transcription failed.");
            await handleTurn(turn, started);
          };
          if (pendingCount.current >= 6) {
            failedJobs.current.push(task); setFailedCount(failedJobs.current.length);
            fail(new Error("Speech processing fell behind. Capture stopped; unsent audio is retained for retry after pending reports finish."));
          } else enqueue(task);
        });
        node.port.onmessage = e => {
          if (e.data === "flushed") { flushResolve.current?.(); return; }
          const samples = new Float32Array(e.data);
          setLevel(Math.min(1, Math.sqrt(samples.reduce((sum, n) => sum + n*n, 0) / samples.length) * 8));
          segmenter.current?.push(samples);
        };
        granted.getAudioTracks()[0].onended = () => { if (wanted.current && !stopping.current) fail(new Error("Microphone disconnected. Reconnect it, then restart the session.")); };
        setStarting(false); setRecording(true); setStatus("Mission listening · reports send at pauses or every 12 seconds");
      }
    } catch (e) { await stopCapture(); fail(e); }
  }
  async function requestReadout() {
    setError(""); busyReadout.current = true; await stopCapture();
    enqueue(async () => {
      setStatus("Preparing current briefing…");
      const state = await jsonRequest("/api/briefings", { incidentId: props.incidentId });
      props.onIncident(state); latest.current = { ...latest.current, incident: latestIncident(latest.current.incident, state) };
      try { await playBriefing(state); } finally { busyReadout.current = false; resumeCapture(); }
    });
  }
  return <section className="panel voice-console" aria-label="Live speech loop">
    <div className="panel-heading"><div><p className="eyebrow">LIVE VOICE / SHARED INCIDENT</p><h2>Speak. See the change. Hear the briefing.</h2></div><span className={`chip ${recording ? "recording" : ""}`}>{recording ? "● MICROPHONE ON" : starting ? "CONNECTING" : "MICROPHONE OFF"}</span></div>
    <div className="voice-controls">
      <label>Speaking as<select value={voiceSpeaker} disabled={active || props.externalBusy} onChange={e => setVoiceSpeaker(e.target.value)}>{["Firefighter A", "Firefighter B", "911 Dispatcher", "Police Officer", "EMS Paramedic", "Team lead"].map(role => <option key={role}>{role}</option>)}</select></label>
      <label>Speech input<select value={input} disabled={active || props.externalBusy} onChange={e => { setInput(e.target.value as typeof input); setConsent(false); }}><option value="browser">Browser speech{!Speech ? " · unsupported" : ""}</option><option value="gemini" disabled={!props.gemini}>Gemini{!props.gemini ? " · not configured" : ""}</option><option value="deepgram" disabled={!props.deepgram}>Deepgram{!props.deepgram ? " · not configured" : ""}</option></select></label>
      <label>Briefing voice<select value={output} disabled={active || props.externalBusy} onChange={e => setOutput(e.target.value as typeof output)}><option value="browser">Browser voice</option><option value="gemini" disabled={!props.gemini}>Gemini{!props.gemini ? " · not configured" : ""}</option><option value="minimax" disabled={!props.minimax}>MiniMax{!props.minimax ? " · not configured" : ""}</option></select></label>
    </div>
    <p className="voice-provider">{input === "browser" ? "Live recognition uses your browser’s speech service; audio may leave this device." : `Audio segments go to ${input === "gemini" ? "Gemini" : "Deepgram"} at pauses or every 12 seconds. Capture continues until you stop the session.`} {props.mode === "gemini" ? "Gemini extracts the reported facts." : "Scenario rules organize the transcript; unknown reports remain visible for review."}</p>
    <label className="checkbox"><input type="checkbox" checked={consent} disabled={active} onChange={e => setConsent(e.target.checked)} />Allow the selected speech service to process this microphone session.</label>
    <div className="voice-controls">
      <button onClick={() => void startCapture(false)} disabled={active || failedCount > 0 || props.externalBusy || !consent || (input === "browser" ? !Speech : input === "gemini" ? !props.gemini : !props.deepgram)}>Start mission microphone</button>
      <button className="secondary" onClick={() => void endSession()} disabled={!session && !recording && !starting}>Stop session</button>
      <button className="secondary" onClick={() => void requestReadout()} disabled={props.externalBusy || starting || playing || pending > 0 || !props.incident?.observations.length}>Request and read briefing</button>
      <button className="text-button" onClick={() => { cancelPlayback(); setStatus("Playback stopped"); }} disabled={!playing}>Stop playback</button>
    </div>
    <p className="small muted">Say “Relay, give me the latest briefing.” Capture pauses during readout to prevent feedback, then resumes automatically while the session is active.</p>
    <meter className="voice-meter" aria-label="Microphone input level" min="0" max="1" value={level} />
    <div className="voice-status" role="status">{status}{pending > 0 ? ` · ${pending} pending` : ""}{elapsed !== undefined ? ` · last speech request ${elapsed} ms` : ""}</div>
    {interim && <p className="voice-interim">Hearing: {interim}</p>}
    {last && <p className="voice-transcript"><strong>Last recognized:</strong> {last}</p>}
    {failedCount > 0 && <div className="error" role="alert">{failedCount} failed request{failedCount === 1 ? " is" : "s are"} retained in this tab. Keep the tab open until retried.
      <button className="secondary" disabled={active || props.externalBusy} onClick={() => {
        const jobs = failedJobs.current.splice(0); setFailedCount(0); setError(""); jobs.forEach(task => enqueue(task));
      }}>Retry retained requests</button></div>}
    {gaps.length > 0 && <details className="voice-gaps"><summary>Capture interruptions ({gaps.length})</summary>{gaps.map((gap, i) => <p key={i}>{gap}</p>)}</details>}
    {error && <div className="error" role="alert">{error} {last && "Last recognized text is shown above; check the timeline before retrying."}</div>}
  </section>;
}
