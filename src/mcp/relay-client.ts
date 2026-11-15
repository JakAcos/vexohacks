import type { Incident, ExternalProposal, MissionSummary } from "../shared/model.js";

export type RelayClientConfig = { baseUrl?: string; accessToken?: string; timeoutMs?: number };

export class RelayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Thin HTTP client for the Relay API. All validation and safety checks stay on the Relay server. */
export class RelayClient {
  readonly baseUrl: string;
  constructor(private readonly config: RelayClientConfig = {}) {
    const url = new URL(config.baseUrl ?? "http://127.0.0.1:3001");
    if (url.username || url.password) throw new Error("RELAY_URL must not contain credentials; use RELAY_ACCESS_TOKEN.");
    this.baseUrl = url.origin;
  }

  async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers = this.auth();
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error", signal: AbortSignal.timeout(this.config.timeoutMs ?? 15000),
      });
    } catch (error) {
      throw new RelayError(0, `Could not reach Relay at ${this.baseUrl}: ${(error as Error).message}. Is the server running (npm start)?`);
    }
    const text = await res.text();
    let data: unknown = text;
    try { data = text ? JSON.parse(text) : undefined; } catch { /* keep raw text */ }
    if (!res.ok) {
      const err = data as { error?: string; details?: string[] } | undefined;
      const detail = err?.details?.length ? ` (${err.details.join("; ")})` : "";
      throw new RelayError(res.status, `Relay returned HTTP ${res.status}: ${err?.error ?? text}${detail}`);
    }
    return data as T;
  }

  private auth(): Record<string, string> {
    return this.config.accessToken ? { Authorization: `Bearer ${this.config.accessToken}` } : {};
  }

  /**
   * Follow Relay's live server-sent event stream for one mission. The first event is the
   * current snapshot; every later event is a committed change. Resolves when the stream ends.
   */
  async watch(id: string, onState: (state: Incident) => void, signal: AbortSignal): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/incidents/${encodeURIComponent(id)}/events`, { headers: { ...this.auth(), Accept: "text/event-stream" }, redirect: "error", signal });
    } catch (error) {
      if (signal.aborted) return;
      throw new RelayError(0, `Could not reach Relay at ${this.baseUrl}: ${(error as Error).message}.`);
    }
    if (!res.ok || !res.body) throw new RelayError(res.status, `Relay event stream returned HTTP ${res.status}.`);
    const decoder = new TextDecoder();
    let buffer = "";
    // Cancel the reader explicitly: aborting the fetch alone does not end a pending body
    // read once data (e.g. Relay's 15 s heartbeat) has arrived, which hung long waits.
    const reader = res.body.getReader();
    const stop = () => { void reader.cancel().catch(() => {}); };
    if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = frame.split("\n").filter(l => l.startsWith("data: ")).map(l => l.slice(6)).join("\n");
          if (frame.split("\n").some(l => l === "event: incident") && data) onState(JSON.parse(data) as Incident);
        }
      }
    } catch (error) { if (!signal.aborted) throw error; }
    finally { signal.removeEventListener("abort", stop); }
  }

  health() { return this.request<Record<string, unknown>>("GET", "/api/health"); }
  mission(id: string) { return this.request<Incident>("GET", `/api/incidents/${encodeURIComponent(id)}`); }
  submitReport(input: { incidentId: string; speaker: string; text: string; clientEventId: string }) {
    return this.request<Incident>("POST", "/api/observations", { ...input, inputKind: "typed" });
  }
  approveAction(incidentId: string, actionId: string, approvedBy: string, expectedVersion: number) {
    return this.request<Incident>("POST", `/api/actions/${encodeURIComponent(actionId)}/approve`, { incidentId, approvedBy, expectedVersion });
  }
  dismissAction(incidentId: string, actionId: string, expectedVersion: number) {
    return this.request<Incident>("POST", `/api/actions/${encodeURIComponent(actionId)}/dismiss`, { incidentId, expectedVersion });
  }
  briefing(incidentId: string) { return this.request<Incident>("POST", "/api/briefings", { incidentId }); }
  retryReport(incidentId: string, jobId: string) {
    return this.request<Incident>("POST", `/api/reports/${encodeURIComponent(jobId)}/retry`, { incidentId });
  }
  listMissions() { return this.request<{ missions: MissionSummary[] }>("GET", "/api/incidents"); }
  proposeAction(input: ExternalProposal) {
    return this.request<{ actionId: string; outcome: "created" | "linked" | "duplicate"; incident: Incident }>("POST", "/api/actions/propose", input);
  }
  retryPlanning(incidentId: string, observationId: string) {
    return this.request<Incident>("POST", `/api/observations/${encodeURIComponent(observationId)}/plan`, { incidentId });
  }
}
