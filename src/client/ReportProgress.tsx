import React from "react";
import type { Incident } from "../shared/model";
export function ReportProgress({ incident, act }: { incident?: Incident; act: (label: string, path: string, body: unknown) => Promise<boolean> }) {
  const jobs = incident?.reportJobs?.filter(job => job.status !== "complete") ?? [];
  if (!jobs.length) return null;
  const labels = { queued: "Saved · waiting for AI", transcribing: "Audio saved · transcribing", extracting: "Report saved · reading report", planning: "Report saved · planning actions", failed: "Saved · processing needs retry", complete: "Complete" };
  return <section className="panel report-progress-panel" aria-label="Saved reports processing"><h2>Saved reports</h2><p className="small muted">Your mission stays available while AI processes these reports.</p>
    {jobs.map(job => <div key={job.id} className="report-progress" role="status"><strong>{job.speaker}</strong> · {labels[job.status]}
      {job.status === "failed" && <><p className="small muted">{job.error}</p><button className="secondary" onClick={() => void act("Retrying saved report", `/reports/${job.id}/retry`, {incidentId: incident!.id})}>Retry saved report</button></>}
    </div>)}
  </section>;
}
