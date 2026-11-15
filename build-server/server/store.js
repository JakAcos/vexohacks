import { mkdir, readFile, rename, readdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { incidentIdSchema, } from "../shared/model.js";
import { briefingText, isResidentResolution, extractDemo, extractGemini } from "./agents.js";
import { audit, demoPlan, modelPlan, applyProposals, deliverSimulated } from "./orchestrator.js";
import { transcribeAudio, transcribeGemini } from "./voice.js";
import { isBriefingCommand } from "../shared/voice.js";
export class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
export class Store {
    directory;
    adapters;
    isLegacyBandMetadata(id, state) {
        const value = state;
        return id === "band-session-state" && value !== null && typeof value === "object"
            && typeof value.status === "string" && typeof value.bandNumber === "number"
            && typeof value.receivedPackets === "number" && !Array.isArray(value.observations);
    }
    queues = new Map();
    tasks = new Map();
    planners = new Map();
    running = 0;
    slots = [];
    stopped = false;
    constructor(directory, adapters = {}) {
        this.directory = directory;
        this.adapters = adapters;
    }
    jobKey(id, jobId) { return `${id}:${jobId}`; }
    audioPath(id, jobId) { return join(this.directory, `${id}.${jobId}.audio`); }
    async durableWrite(path, data) {
        await mkdir(this.directory, { recursive: true });
        const temp = `${path}.${randomUUID()}.tmp`;
        const file = await open(temp, "wx", 0o600);
        try {
            await file.writeFile(data);
            await file.sync();
        }
        finally {
            await file.close();
        }
        try {
            await rename(temp, path);
            const directory = await open(this.directory, "r");
            try {
                await directory.sync();
            }
            finally {
                await directory.close();
            }
        }
        finally {
            await unlink(temp).catch(() => { });
        }
    }
    async resume() {
        await mkdir(this.directory, { recursive: true });
        for (const name of await readdir(this.directory)) {
            if (!/^[a-zA-Z0-9_-]{1,64}\.json$/.test(name))
                continue;
            const id = name.slice(0, -5);
            // Older builds placed microphone metadata beside mission snapshots. Preserve
            // it for BandSession migration; it must never enter mission processing.
            if (id === "band-session-state" && this.isLegacyBandMetadata(id, JSON.parse(await readFile(join(this.directory, name), "utf8"))))
                continue;
            let state = await this.get(id);
            const originalOrder = state.observations.map(o => o.id).join(",");
            this.orderObservations(state);
            if (state.observations.map(o => o.id).join(",") !== originalOrder) {
                state = await this.mutate(id, current => {
                    this.orderObservations(current);
                    this.rebuildIssues(current);
                    current.version++;
                    audit(current, "coordinator", "Restored saved audio reports to their received order. Original reports and action receipts were preserved.");
                });
            }
            this.adapters.onChange?.(state);
            for (const job of state.reportJobs ?? []) {
                if (job.status !== "complete" && job.status !== "failed")
                    this.schedule(id, job.id);
            }
        }
    }
    async idle() { while (this.tasks.size)
        await Promise.all([...this.tasks.values()]); }
    async close() { this.stopped = true; await this.idle(); }
    async planOrdered(id, work) {
        const previous = this.planners.get(id) ?? Promise.resolve();
        const task = previous.catch(() => { }).then(work);
        this.planners.set(id, task);
        try {
            await task;
        }
        finally {
            if (this.planners.get(id) === task)
                this.planners.delete(id);
        }
    }
    schedule(id, jobId, extract) {
        const key = this.jobKey(id, jobId);
        if (this.stopped || this.tasks.has(key))
            return;
        const task = Promise.resolve().then(async () => {
            if (this.running >= (this.adapters.concurrency ?? 4))
                await new Promise(r => this.slots.push(r));
            else
                this.running++;
            try {
                if (!this.stopped)
                    await this.process(id, jobId, extract);
            }
            finally {
                const next = this.slots.shift();
                if (next)
                    next();
                else
                    this.running--;
            }
        }).catch(error => {
            // Provider failures are persisted by process. A storage failure cannot be acknowledged
            // as processed; the durable queued job is replayed after the service restarts.
            console.error("Report worker could not save progress", error instanceof Error ? error.message : "storage error");
        }).finally(() => this.tasks.delete(key));
        this.tasks.set(key, task);
    }
    async get(id) {
        incidentIdSchema.parse(id);
        try {
            const state = JSON.parse(await readFile(join(this.directory, `${id}.json`), "utf8"));
            if (this.isLegacyBandMetadata(id, state))
                throw new HttpError(409, "This saved file contains band session settings, not a mission.");
            state.revision ??= 0;
            state.reportJobs ??= [];
            state.actions ??= [];
            state.agentEvents ??= [];
            state.voiceCommands ??= [];
            return state;
        }
        catch (e) {
            if (e.code === "ENOENT")
                return this.empty(id);
            throw e;
        }
    }
    empty(id) {
        return {
            id,
            title: "Apartment building · smoke assessment",
            version: 0,
            revision: 0,
            reportJobs: [],
            observations: [],
            issues: [],
            briefings: [],
            handovers: [],
            actions: [],
            agentEvents: [],
            voiceCommands: [],
            updatedAt: new Date().toISOString(),
        };
    }
    async ordered(id, work) {
        incidentIdSchema.parse(id);
        const previous = this.queues.get(id) ?? Promise.resolve();
        const job = previous.catch(() => { }).then(work);
        this.queues.set(id, job);
        try {
            return await job;
        }
        finally {
            if (this.queues.get(id) === job)
                this.queues.delete(id);
        }
    }
    async snapshot(id, receive) {
        return this.ordered(id, async () => receive(await this.get(id)));
    }
    async mutate(id, fn) {
        return this.ordered(id, async () => {
            const state = await this.get(id);
            const revision = (state.revision ?? 0) + 1;
            await fn(state);
            state.revision = revision;
            state.updatedAt = new Date().toISOString();
            await this.durableWrite(join(this.directory, `${id}.json`), JSON.stringify(state, null, 2));
            this.adapters.onChange?.(state);
            return state;
        });
    }
    duplicate(state, clientEventId) {
        return clientEventId ? state.reportJobs?.find(j => j.clientEventId === clientEventId) : undefined;
    }
    async acceptRecord(id, speaker, text, mode, inputKind = "typed", clientEventId, sourceDevice, extract, imported) {
        let jobId;
        const state = await this.mutate(id, state => {
            if (clientEventId && state.voiceCommands.some(c => c.clientEventId === clientEventId))
                throw new HttpError(409, "Voice event identifier already used for a command.");
            const existing = clientEventId && state.observations.find(o => o.clientEventId === clientEventId);
            if (existing) {
                if (existing.speaker !== speaker || existing.text !== text || existing.inputKind !== inputKind || JSON.stringify(existing.sourceDevice) !== JSON.stringify(sourceDevice))
                    throw new HttpError(409, "Report identifier was already used for different content.");
                jobId = this.duplicate(state, clientEventId)?.id;
                return;
            }
            if (this.duplicate(state, clientEventId))
                throw new HttpError(409, "Report identifier already used for audio.");
            const timestamp = new Date().toISOString();
            const observation = { id: randomUUID(), clientEventId, sourceDevice, speaker, text, timestamp, mode, inputKind, processingMs: 0, facts: imported?.facts ?? [], factsReady: Boolean(imported), importedFrom: imported?.origin, processing: "queued" };
            const job = { id: randomUUID(), clientEventId, speaker, mode, inputKind, sourceDevice, observationId: observation.id, status: "queued", submittedAt: timestamp, timings: {} };
            state.observations.push(observation);
            (state.reportJobs ??= []).push(job);
            if (imported)
                this.rebuildIssues(state);
            state.version++;
            jobId = job.id;
        });
        const job = state.reportJobs?.find(j => j.id === jobId);
        if (job && !["complete", "failed"].includes(job.status))
            this.schedule(id, job.id, extract);
        return state;
    }
    async acceptAudio(id, speaker, audio, contentType, provider, mode, clientEventId, inputKind = "transcript", sourceDevice, captureMode) {
        let jobId = "";
        const hash = createHash("sha256").update(audio).digest("hex");
        const state = await this.mutate(id, async (state) => {
            const existing = this.duplicate(state, clientEventId);
            if (existing) {
                if (existing.speaker !== speaker || existing.audio?.sha256 !== hash || existing.audio.provider !== provider || existing.audio.contentType !== contentType || existing.captureMode !== captureMode || existing.inputKind !== inputKind || JSON.stringify(existing.sourceDevice) !== JSON.stringify(sourceDevice))
                    throw new HttpError(409, "Audio identifier was already used for different content.");
                jobId = existing.id;
                return;
            }
            if (clientEventId && (state.observations.some(o => o.clientEventId === clientEventId) || state.voiceCommands.some(c => c.clientEventId === clientEventId)))
                throw new HttpError(409, "Voice event identifier already used.");
            jobId = randomUUID();
            await this.durableWrite(this.audioPath(id, jobId), audio);
            (state.reportJobs ??= []).push({ id: jobId, clientEventId, speaker, mode, inputKind, sourceDevice, captureMode, status: "queued", submittedAt: new Date().toISOString(), audio: { contentType, provider, sha256: hash }, timings: {} });
            // Audio might contain material information, so invalidate older approvals immediately.
            state.version++;
        });
        const job = state.reportJobs.find(j => j.id === jobId);
        if (!["complete", "failed"].includes(job.status))
            this.schedule(id, jobId);
        return { incident: state, jobId, kind: "queued", transcript: "" };
    }
    async updateJob(id, jobId, fn) {
        return this.mutate(id, state => {
            const job = state.reportJobs?.find(j => j.id === jobId);
            if (!job)
                return; // A reset removed this job. Never recreate it from a late response.
            fn(state, job);
            const observation = state.observations.find(o => o.id === job.observationId);
            if (observation)
                observation.processing = job.status;
        });
    }
    orderObservations(state) {
        const order = new Map((state.reportJobs ?? []).map((job, index) => [job.observationId, index]));
        // Legacy reports have no job, so keep their stable relative order before new intake.
        state.observations.sort((a, b) => (order.get(a.id) ?? -1) - (order.get(b.id) ?? -1));
    }
    rebuildIssues(state) {
        state.issues = [];
        for (const observation of state.observations) {
            for (const original of observation.facts) {
                const fact = { ...original };
                if (fact.topic === "occupant")
                    fact.uncertain = true;
                // Only an explicit resident correction can close the resident-reported occupant concern.
                if (fact.topic === "occupant" &&
                    fact.status === "resolved" &&
                    !(fact.source === "resident" && isResidentResolution(observation.text))) {
                    fact.status = "contradiction";
                    fact.uncertain = true;
                }
                const key = fact.topic === "other"
                    ? `other-${observation.id}`
                    : fact.topic === "occupant"
                        ? `occupant-${fact.source}`
                        : fact.topic;
                const source = fact.source === "resident" ? `Resident via ${observation.speaker}` : observation.speaker;
                const evidence = {
                    observationId: observation.id,
                    source,
                    timestamp: observation.timestamp,
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
                        status: fact.status === "contradiction"
                            ? "conflicting"
                            : fact.status === "resolved"
                                ? "resolved"
                                : "active",
                        uncertain: fact.uncertain,
                        evidence: [],
                    };
                    state.issues.push(issue);
                }
                else if (fact.topic === "occupant" &&
                    fact.source === "resident" &&
                    fact.status === "resolved")
                    issue.status =
                        issue.status === "conflicting" ? "conflicting" : "resolved";
                else if (fact.status === "contradiction" ||
                    (issue.status === "resolved" && fact.status === "reported") ||
                    (issue.status === "active" && fact.status === "resolved"))
                    issue.status = "conflicting";
                issue.uncertain = issue.uncertain || fact.uncertain;
                issue.evidence.push(evidence);
            }
        }
    }
    async process(id, jobId, extract) {
        try {
            let state = await this.get(id), job = state.reportJobs?.find(j => j.id === jobId);
            if (!job || job.status === "complete" || job.status === "failed")
                return;
            if (job.audio && !job.observationId && !job.briefingId) {
                await this.updateJob(id, jobId, (_, j) => { j.status = "transcribing"; delete j.error; });
                const started = performance.now();
                const bytes = await readFile(this.audioPath(id, jobId));
                const text = await (this.adapters.transcribe ?? ((a, c, p, allowSilence) => p === "gemini" ? transcribeGemini(a, c, allowSilence) : transcribeAudio(a, c)))(bytes, job.audio.contentType, job.audio.provider, job.captureMode === "continuous");
                if (!text.trim() && job.captureMode === "continuous") {
                    await this.updateJob(id, jobId, (_, j) => { j.result = "silence"; j.status = "complete"; j.completedAt = new Date().toISOString(); j.timings.transcriptionMs = Math.round(performance.now() - started); j.timings.totalMs = Date.now() - Date.parse(j.submittedAt); });
                    await unlink(this.audioPath(id, jobId)).catch(() => { });
                    return;
                }
                if (!text.trim() || text.length > 4000)
                    throw new Error("Transcription was empty or too long. Audio retained for retry.");
                state = await this.updateJob(id, jobId, (current, j) => {
                    j.timings.transcriptionMs = Math.round(performance.now() - started);
                    if (isBriefingCommand(text)) {
                        const item = { id: randomUUID(), text: briefingText(current), timestamp: new Date().toISOString(), revision: current.briefings.length + current.handovers.length + 1, stateVersion: current.version };
                        current.briefings.push(item);
                        j.briefingId = item.id;
                        j.status = "complete";
                        if (j.clientEventId)
                            current.voiceCommands.push({ clientEventId: j.clientEventId, speaker: j.speaker, transcript: text, briefingId: item.id });
                        j.completedAt = new Date().toISOString();
                        j.timings.totalMs = Date.now() - Date.parse(j.submittedAt);
                    }
                    else {
                        const observation = { id: randomUUID(), clientEventId: j.clientEventId, sourceDevice: j.sourceDevice, speaker: j.speaker, text, timestamp: j.submittedAt, mode: j.mode, inputKind: j.inputKind, processingMs: 0, facts: [], factsReady: false, processing: "queued" };
                        current.observations.push(observation);
                        j.observationId = observation.id;
                        this.orderObservations(current);
                        j.status = "queued";
                        current.version++;
                    }
                });
                job = state.reportJobs?.find(j => j.id === jobId);
                if (!job || job.status === "complete") {
                    await unlink(this.audioPath(id, jobId)).catch(() => { });
                    return;
                }
            }
            let observation = state.observations.find(o => o.id === job.observationId);
            if (!observation)
                return;
            if (!observation.factsReady) {
                await this.updateJob(id, jobId, (_, j) => { j.status = "extracting"; delete j.error; });
                const started = performance.now();
                const facts = await (extract ? extract() : this.adapters.extract ? this.adapters.extract(observation.text, observation.speaker, job.mode) : job.mode === "gemini" ? extractGemini(observation.text, observation.speaker) : Promise.resolve(extractDemo(observation.text)));
                state = await this.updateJob(id, jobId, (current, j) => {
                    const o = current.observations.find(o => o.id === j.observationId);
                    o.facts = facts;
                    o.factsReady = true;
                    j.timings.extractionMs = Math.round(performance.now() - started);
                    j.status = "planning";
                    current.version++;
                    this.rebuildIssues(current);
                });
            }
            // Serialize only planning, not intake/extraction or the mission write lock.
            // A newer report invalidates a proposal, not its durable source job. Replan
            // automatically from current context instead of failing after three updates.
            await this.planOrdered(id, async () => {
                while (!this.stopped) {
                    state = await this.updateJob(id, jobId, (_, j) => { j.status = "planning"; delete j.error; });
                    job = state.reportJobs?.find(j => j.id === jobId);
                    observation = state.observations.find(o => o.id === job?.observationId);
                    if (!job || !observation)
                        return;
                    const version = state.version, actions = JSON.stringify(state.actions), started = performance.now();
                    const proposals = await (this.adapters.plan ? this.adapters.plan(state, observation, job.mode) : job.mode === "gemini" ? modelPlan(state, observation, this.adapters.testDestination) : Promise.resolve(demoPlan(observation)));
                    let stale = false;
                    await this.updateJob(id, jobId, (current, j) => {
                        j.timings.planningMs = (j.timings.planningMs ?? 0) + Math.round(performance.now() - started);
                        if (current.version !== version || JSON.stringify(current.actions) !== actions) {
                            stale = true;
                            return;
                        }
                        applyProposals(current, current.observations.find(o => o.id === j.observationId), j.mode, proposals, this.adapters.testDestination);
                        j.status = "complete";
                        j.completedAt = new Date().toISOString();
                        j.timings.totalMs = Date.now() - Date.parse(j.submittedAt);
                        current.observations.find(o => o.id === j.observationId).processingMs = j.timings.totalMs;
                    });
                    if (!stale) {
                        if (job.audio)
                            await unlink(this.audioPath(id, jobId)).catch(() => { });
                        return;
                    }
                    // Coalesce rapid updates before the next model call. Shutdown leaves the
                    // job in planning so resume() can continue it with the same identity.
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            });
        }
        catch (error) {
            await this.updateJob(id, jobId, (state, job) => {
                job.status = "failed";
                job.error = error instanceof Error ? error.message : "Processing failed.";
                audit(state, "coordinator", `Report saved. Background processing or action planning failed; retry this saved report. ${job.error}`);
            });
        }
    }
    async retryReport(id, jobId) {
        const state = await this.mutate(id, state => {
            const job = state.reportJobs?.find(j => j.id === jobId);
            if (!job)
                throw new HttpError(404, "Saved report not found.");
            if (job.status === "complete")
                return;
            job.status = "queued";
            delete job.error;
            const observation = state.observations.find(o => o.id === job.observationId);
            if (observation)
                observation.processing = "queued";
        });
        if (state.reportJobs.find(j => j.id === jobId).status !== "complete") {
            const running = this.tasks.get(this.jobKey(id, jobId));
            if (running)
                void running.then(() => this.schedule(id, jobId));
            else
                this.schedule(id, jobId);
        }
        return state;
    }
    // Compatibility for in-process callers: durable intake first, then await this job only.
    async record(id, speaker, text, mode, extract, inputKind = "typed", clientEventId, sourceDevice) {
        const accepted = await this.acceptRecord(id, speaker, text, mode, inputKind, clientEventId, sourceDevice, extract);
        const job = clientEventId ? accepted.reportJobs?.find(j => j.clientEventId === clientEventId) : accepted.reportJobs?.at(-1);
        if (job)
            await this.tasks.get(this.jobKey(id, job.id));
        return this.get(id);
    }
    async approveAction(id, actionId, approvedBy, expectedVersion) {
        return this.mutate(id, state => {
            const action = state.actions.find(a => a.id === actionId);
            if (!action)
                throw new HttpError(404, "Mission action not found.");
            // Network retries return the original receipt, never another dispatch.
            if (action.status === "acknowledged")
                return;
            if (action.status !== "proposed")
                throw new HttpError(409, "This action was dismissed.");
            if (state.version !== expectedVersion)
                throw new HttpError(409, "Mission context changed. Review the latest reports before approving.");
            action.approvedBy = approvedBy;
            audit(state, "dispatcher", `${approvedBy} approved ${action.title}.`, action.id);
            deliverSimulated(state, action);
        });
    }
    /**
     * An outside agent proposes an action. It must cite existing reports, always waits for
     * dispatcher approval (even team updates) and never reaches the automatic test desk.
     * It does not bump the mission version: a proposal adds no new evidence.
     */
    async proposeExternal(input) {
        let result;
        const state = await this.mutate(input.incidentId, state => {
            if (input.clientEventId) {
                const prior = state.actions.find(a => a.proposedBy?.clientEventId === input.clientEventId);
                if (prior) {
                    result = { actionId: prior.id, outcome: "duplicate" };
                    return;
                }
            }
            const missing = input.sourceObservationIds.filter(sid => !state.observations.some(o => o.id === sid));
            if (missing.length)
                throw new HttpError(422, `Unknown source report id(s): ${missing.join(", ")}. Cite reports from this mission.`);
            const now = new Date().toISOString();
            const existing = input.kind === "service_request" && state.actions.find(a => a.kind === "service_request" && a.service === input.service && a.status !== "dismissed");
            if (existing) {
                for (const sid of input.sourceObservationIds)
                    if (!existing.sourceObservationIds.includes(sid))
                        existing.sourceObservationIds.push(sid);
                existing.updatedAt = now;
                audit(state, "coordinator", `External agent ${input.proposedBy} proposed ${input.service} support; linked to the existing request instead of duplicating it.`, existing.id);
                result = { actionId: existing.id, outcome: "linked" };
                return;
            }
            const action = {
                id: randomUUID(), kind: input.kind, service: input.service, title: input.title, detail: input.detail,
                sourceObservationIds: [...new Set(input.sourceObservationIds)], status: "proposed", createdAt: now, updatedAt: now,
                proposedBy: { agent: input.proposedBy, clientEventId: input.clientEventId },
            };
            state.actions.push(action);
            audit(state, "coordinator", `External agent ${input.proposedBy} proposed ${action.title} · awaiting dispatcher approval`, action.id);
            result = { actionId: action.id, outcome: "created" };
        });
        return { ...result, incident: state };
    }
    /** Saved missions only; an ID nobody has written to yet is not listed. */
    async list() {
        const out = [];
        for (const name of await readdir(this.directory).catch(() => [])) {
            const m = /^([a-zA-Z0-9_-]{1,64})\.json$/.exec(name);
            if (!m)
                continue;
            try {
                const s = await this.get(m[1]);
                if (!Array.isArray(s.observations))
                    continue;
                out.push({ id: s.id, title: s.title, version: s.version, updatedAt: s.updatedAt, reports: s.observations.length,
                    activeIssues: s.issues.filter(i => i.status !== "resolved").length, pendingActions: s.actions.filter(a => a.status === "proposed").length });
            }
            catch { /* not a mission file (e.g. band session settings) */ }
        }
        return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    async dismissAction(id, actionId, expectedVersion) {
        return this.mutate(id, state => {
            const action = state.actions.find(a => a.id === actionId);
            if (!action)
                throw new HttpError(404, "Mission action not found.");
            if (state.version !== expectedVersion)
                throw new HttpError(409, "Mission context changed. Review the latest reports first.");
            if (action.status !== "proposed")
                throw new HttpError(409, "Only pending actions can be dismissed.");
            action.status = "dismissed";
            action.updatedAt = new Date().toISOString();
            audit(state, "dispatcher", `${action.title} dismissed.`, action.id);
        });
    }
    async retryPlanning(id, observationId, mode) {
        const state = await this.get(id);
        const observation = state.observations.find(o => o.id === observationId);
        if (!observation)
            throw new HttpError(404, "Observation not found.");
        let job = state.reportJobs?.find(j => j.observationId === observationId);
        if (!job) {
            const updated = await this.mutate(id, current => {
                (current.reportJobs ??= []).push({ id: randomUUID(), speaker: observation.speaker, mode, inputKind: observation.inputKind, observationId, status: "queued", submittedAt: new Date().toISOString(), timings: {} });
                current.observations.find(o => o.id === observationId).factsReady = true;
            });
            job = updated.reportJobs.at(-1);
        }
        return this.retryReport(id, job.id);
    }
    async briefing(id, handover = false) {
        return this.mutate(id, (state) => {
            const item = {
                id: randomUUID(),
                text: briefingText(state),
                timestamp: new Date().toISOString(),
                revision: state.briefings.length + state.handovers.length + 1,
                stateVersion: state.version,
            };
            if (handover)
                state.handovers.push(item);
            else
                state.briefings.push(item);
        });
    }
    async voiceBriefing(id, speaker, transcript, clientEventId) {
        return this.mutate(id, state => {
            if (clientEventId) {
                const previous = state.voiceCommands.find(c => c.clientEventId === clientEventId);
                if (previous) {
                    if (previous.speaker !== speaker || previous.transcript !== transcript)
                        throw new HttpError(409, "Voice event identifier already used for a different command.");
                    return;
                }
                if (state.observations.some(o => o.clientEventId === clientEventId))
                    throw new HttpError(409, "Voice event identifier already used for a report.");
            }
            const item = { id: randomUUID(), text: briefingText(state), timestamp: new Date().toISOString(), revision: state.briefings.length + state.handovers.length + 1, stateVersion: state.version };
            state.briefings.push(item);
            if (clientEventId)
                state.voiceCommands.push({ clientEventId, speaker, transcript, briefingId: item.id });
        });
    }
    async approve(id, handoverId, approvedBy, expectedVersion) {
        return this.mutate(id, (state) => {
            const item = state.handovers.find((h) => h.id === handoverId);
            if (!item)
                throw new HttpError(404, "Handover not found.");
            if (item.approvedAt)
                throw new HttpError(409, "This handover is already approved.");
            if (item.stateVersion !== state.version ||
                expectedVersion !== state.version)
                throw new HttpError(409, "Incident changed. Prepare and review a fresh handover before approving.");
            item.approvedAt = new Date().toISOString();
            item.approvedBy = approvedBy;
        });
    }
    async reset(id) {
        return this.mutate(id, (state) => {
            Object.assign(state, this.empty(id));
        });
    }
}
