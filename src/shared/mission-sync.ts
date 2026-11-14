import type { Incident } from "./model.js";

// Reports, approvals, briefings and resets all advance the snapshot revision.
// Arrival order is unreliable when HTTP responses race with the live feed.
export function latestIncident(current: Incident | undefined, incoming: Incident): Incident {
  if (!current || current.id !== incoming.id) return incoming;
  if (current.revision !== undefined && incoming.revision !== undefined) {
    return incoming.revision >= current.revision ? incoming : current;
  }
  if (current.revision !== undefined) return current;
  if (incoming.revision !== undefined) return incoming;
  return incoming.updatedAt >= current.updatedAt ? incoming : current;
}

export class ReportSubmissions {
  private pending = new Map<string, string>();
  constructor(private makeId: () => string = () => crypto.randomUUID()) {}
  prepare(incidentId: string, speaker: string, text: string) {
    const report = { incidentId, speaker: speaker.trim(), text: text.trim() };
    const key = JSON.stringify(report);
    let clientEventId = this.pending.get(key);
    if (!clientEventId) {
      clientEventId = this.makeId();
      this.pending.set(key, clientEventId);
    }
    return { ...report, clientEventId };
  }
  confirm(report: ReturnType<ReportSubmissions["prepare"]>) {
    const { clientEventId, ...content } = report;
    const key = JSON.stringify(content);
    if (this.pending.get(key) === clientEventId) this.pending.delete(key);
  }
}
