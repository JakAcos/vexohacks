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
        <div className="sponsor-card-title"><h3>Vexo</h3><span className={`sponsor-badge ${evidence.vexoPhysical ? "sponsor-recorded" : ""}`}>{evidence.vexoPhysical ? `Band ${evidence.vexoPhysical.sourceDevice!.bandNumber} input recorded` : evidence.vexo ? "Simulator report received" : "Awaiting wearable input"}</span></div>
        <p>Bring a responder's observation into the shared mission.</p>
        <strong className="sponsor-result">{evidence.vexoPhysical ? `${evidence.vexoPhysicalCount} bridge-sourced report${evidence.vexoPhysicalCount === 1 ? "" : "s"} recorded` : evidence.vexo ? `${evidence.vexoCount} simulator report${evidence.vexoCount === 1 ? "" : "s"} recorded` : "No Vexo device reports in this incident"}</strong>
        <p className="sponsor-meta">{evidence.vexoPhysical ? `${inputLabel(evidence.vexoPhysical)} · captured ${new Date(evidence.vexoPhysical.sourceDevice!.capturedAt).toLocaleTimeString()}. Source metadata came with the saved bridge report.` : evidence.vexo ? "Scripted text through the simulator adapter. Physical audio is not verified by this receipt." : "Laptop speech and typed reports do not count as Vexo execution."}</p>
        {evidence.vexoPhysical ? <Receipt observation={evidence.vexoPhysical} /> : evidence.vexo && <Receipt observation={evidence.vexo} />}
        {evidence.vexoPhysical && evidence.vexo && <p className="sponsor-meta">Also recorded: {evidence.vexoCount} separate simulator report(s). Simulator input is not counted as band audio.</p>}
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
    <p className="sponsor-footnote">The app maintains mission state and human review. These receipts credit the recorded input and extraction only; they do not establish field reliability or real dispatch. Physical-source labels require saved bridge device metadata.</p>
  </section>;
}
