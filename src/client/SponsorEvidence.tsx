import React from "react";
import type { Incident, Observation } from "../shared/model";
import { inputLabel, sponsorEvidence } from "../shared/sponsorEvidence";
import "./sponsor-evidence.css";

function Receipt({ observation }: { observation: Observation }) {
  return <details className="sponsor-receipt">
    <summary>Inspect input and result</summary>
    <p className="sponsor-meta">{observation.speaker} · {new Date(observation.timestamp).toLocaleTimeString()} · {inputLabel(observation)}</p>
    <blockquote>{observation.text}</blockquote>
    <ul>{observation.facts.map((fact, i) => <li key={i}>
      {fact.label} <span>— {fact.status}{fact.uncertain ? " · unconfirmed" : ""} · {fact.source === "resident" ? "resident report" : "responder report"}</span>
    </li>)}</ul>
    {!observation.facts.length && <p>No structured observations returned.</p>}
    <p className="sponsor-meta">Report {observation.id} · extraction {observation.processingMs} ms</p>
  </details>;
}

export function SponsorEvidence({ incident, mode, connected = false }: {
  incident?: Incident; mode?: "demo" | "gemini"; connected?: boolean;
}) {
  const evidence = sponsorEvidence(incident);
  return <section className="sponsor-evidence" aria-labelledby="sponsor-heading">
    <div className="sponsor-heading">
      <div><p className="sponsor-kicker">MISSION INPUT → SHARED UNDERSTANDING</p>
        <h2 id="sponsor-heading">See what each partner contributes.</h2></div>
      <span className="sponsor-feed">{connected ? "Following incident updates" : "Feed disconnected · showing saved evidence"}</span>
    </div>
    <div className="sponsor-cards">
      <article className="sponsor-card">
        <div className="sponsor-card-title"><h3>Vexo</h3><span className="sponsor-badge">{evidence.vexo ? "Simulator report received" : "Awaiting wearable input"}</span></div>
        <p>Bring a responder's observation into the shared mission.</p>
        <strong className="sponsor-result">{evidence.vexo ? `${evidence.vexoCount} simulator report${evidence.vexoCount === 1 ? "" : "s"} recorded` : "No Vexo-tagged reports in this incident"}</strong>
        <p className="sponsor-meta">{evidence.vexo ? "Scripted text through the simulator adapter. Physical audio is not verified by this receipt." : "Laptop speech and typed reports do not count as Vexo execution."}</p>
        {evidence.vexo && <Receipt observation={evidence.vexo} />}
      </article>
      <article className="sponsor-card">
        <div className="sponsor-card-title"><h3>Google Gemini</h3><span className={`sponsor-badge ${evidence.gemini ? "sponsor-recorded" : ""}`}>{evidence.gemini ? "Extraction recorded" : "Awaiting execution"}</span></div>
        <p>Turn a report into structured, source-attributed observations.</p>
        <strong className="sponsor-result">{evidence.gemini ? `${evidence.geminiCount} Gemini extraction${evidence.geminiCount === 1 ? "" : "s"} recorded` : "No completed Gemini extraction in this incident"}</strong>
        <p className="sponsor-meta">Current mode: {mode === "gemini" ? "Gemini" : mode === "demo" ? "local scenario rules" : "checking"}. Receipts describe saved results, not provider availability.</p>
        {evidence.gemini && <Receipt observation={evidence.gemini} />}
      </article>
    </div>
    {evidence.latest && <div className="sponsor-latest" role="status">
      <span>Latest report</span><strong>{inputLabel(evidence.latest)} → {evidence.latest.mode === "gemini" ? "Gemini extraction" : "local scenario rules"} → shared incident</strong>
      <p>{evidence.latest.text}</p>
    </div>}
    <p className="sponsor-footnote">The app maintains mission state and human review. These receipts credit the recorded input and extraction only; they do not establish physical hardware verification or real dispatch.</p>
  </section>;
}
