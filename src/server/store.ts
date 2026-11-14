import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type Incident,
  type Fact,
  type Observation,
  type Mode,
  incidentIdSchema,
} from "../shared/model.js";
import { briefingText, isResidentResolution } from "./agents.js";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class Store {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private directory: string) {}
  async get(id: string): Promise<Incident> {
    incidentIdSchema.parse(id);
    try {
      return JSON.parse(
        await readFile(join(this.directory, `${id}.json`), "utf8"),
      ) as Incident;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return this.empty(id);
      throw e;
    }
  }
  private empty(id: string): Incident {
    return {
      id,
      title: "Apartment building · smoke assessment",
      version: 0,
      observations: [],
      issues: [],
      briefings: [],
      handovers: [],
      updatedAt: new Date().toISOString(),
    };
  }
  private async ordered<T>(id: string, work: () => Promise<T>): Promise<T> {
    incidentIdSchema.parse(id);
    const previous = this.queues.get(id) ?? Promise.resolve();
    const job = previous.catch(() => {}).then(work);
    this.queues.set(id, job);
    try {
      return await job;
    } finally {
      if (this.queues.get(id) === job) this.queues.delete(id);
    }
  }
  async snapshot(
    id: string,
    receive: (state: Incident) => void,
  ): Promise<void> {
    return this.ordered(id, async () => receive(await this.get(id)));
  }
  async mutate(
    id: string,
    fn: (state: Incident) => Promise<void> | void,
  ): Promise<Incident> {
    return this.ordered(id, async () => {
      const state = await this.get(id);
      await fn(state);
      state.updatedAt = new Date().toISOString();
      await mkdir(this.directory, { recursive: true });
      const temp = join(this.directory, `${id}.${randomUUID()}.tmp`);
      await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(temp, join(this.directory, `${id}.json`));
      return state;
    });
  }
  async record(
    id: string,
    speaker: string,
    text: string,
    mode: Mode,
    extract: () => Promise<Fact[]>,
    inputKind: Observation["inputKind"] = "typed",
  ): Promise<Incident> {
    return this.mutate(id, async (state) => {
      const start = performance.now();
      const facts = await extract();
      const timestamp = new Date().toISOString();
      const observation: Observation = {
        id: randomUUID(),
        speaker,
        text,
        timestamp,
        mode,
        inputKind,
        processingMs: Math.round(performance.now() - start),
        facts,
      };
      state.observations.push(observation);
      state.version++;
      for (const fact of facts) {
        if (fact.topic === "occupant") fact.uncertain = true;
        // Only an explicit resident correction can close the resident-reported occupant concern.
        if (
          fact.topic === "occupant" &&
          fact.status === "resolved" &&
          !(fact.source === "resident" && isResidentResolution(text))
        ) {
          fact.status = "contradiction";
          fact.uncertain = true;
        }
        const key =
          fact.topic === "other"
            ? `other-${observation.id}`
            : fact.topic === "occupant"
              ? `occupant-${fact.source}`
              : fact.topic;
        const source =
          fact.source === "resident" ? `Resident via ${speaker}` : speaker;
        const evidence = {
          observationId: observation.id,
          source,
          timestamp,
          status: fact.status,
          label: fact.label,
          uncertain: fact.uncertain,
        };
        let issue = state.issues.find((i) => i.id === key);
        if (!issue) {
          issue = {
            id: key,
            topic: fact.topic,
            label: fact.label,
            status:
              fact.status === "contradiction"
                ? "conflicting"
                : fact.status === "resolved"
                  ? "resolved"
                  : "active",
            uncertain: fact.uncertain,
            evidence: [],
          };
          state.issues.push(issue);
        } else if (
          fact.topic === "occupant" &&
          fact.source === "resident" &&
          fact.status === "resolved"
        )
          issue.status =
            issue.status === "conflicting" ? "conflicting" : "resolved";
        else if (
          fact.status === "contradiction" ||
          (issue.status === "resolved" && fact.status === "reported") ||
          (issue.status === "active" && fact.status === "resolved")
        )
          issue.status = "conflicting";
        issue.uncertain = issue.uncertain || fact.uncertain;
        issue.evidence.push(evidence);
      }
    });
  }
  async briefing(id: string, handover = false) {
    return this.mutate(id, (state) => {
      const item = {
        id: randomUUID(),
        text: briefingText(state),
        timestamp: new Date().toISOString(),
        revision: state.briefings.length + state.handovers.length + 1,
        stateVersion: state.version,
      };
      if (handover) state.handovers.push(item);
      else state.briefings.push(item);
    });
  }
  async approve(
    id: string,
    handoverId: string,
    approvedBy: string,
    expectedVersion: number,
  ) {
    return this.mutate(id, (state) => {
      const item = state.handovers.find((h) => h.id === handoverId);
      if (!item) throw new HttpError(404, "Handover not found.");
      if (item.approvedAt)
        throw new HttpError(409, "This handover is already approved.");
      if (
        item.stateVersion !== state.version ||
        expectedVersion !== state.version
      )
        throw new HttpError(
          409,
          "Incident changed. Prepare and review a fresh handover before approving.",
        );
      item.approvedAt = new Date().toISOString();
      item.approvedBy = approvedBy;
    });
  }
  async reset(id: string) {
    return this.mutate(id, (state) => {
      Object.assign(state, this.empty(id));
    });
  }
}
