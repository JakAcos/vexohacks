import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { incidentIdSchema, sourceDeviceSchema, factSchema } from '../shared/model.js';
import { saveDispatchFile } from './test-dispatch-files.js';
export function missionSourceConfig(env = process.env) {
    if (!env.RELAY_MISSION_SOURCE_ORIGIN && !env.RELAY_MISSION_SOURCE_ID && !env.RELAY_MISSION_TARGET_ID)
        return;
    const url = new URL(env.RELAY_MISSION_SOURCE_ORIGIN ?? '');
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
        throw Error('Mission source must be an explicit loopback HTTP origin.');
    return { origin: url.origin, sourceMission: incidentIdSchema.parse(env.RELAY_MISSION_SOURCE_ID), targetMission: incidentIdSchema.parse(env.RELAY_MISSION_TARGET_ID), bandNumber: z.coerce.number().int().min(1).max(999).parse(env.RELAY_MISSION_SOURCE_BAND ?? 38) };
}
export class MissionSource {
    store;
    config;
    checkpoint;
    timer;
    running;
    stopped = false;
    error;
    lastCheckedAt;
    path;
    constructor(store, directory, config) {
        this.store = store;
        this.config = config;
        this.path = join(directory, '.mission-source', `${createHash('sha256').update(this.identity()).digest('hex')}.json`);
    }
    snapshot() { return { enabled: true, sourceMission: this.config.sourceMission, targetMission: this.config.targetMission, origin: this.config.origin, bandNumber: this.config.bandNumber, baselineAt: this.checkpoint?.baselineAt, imported: this.checkpoint?.imported ?? 0, lastCheckedAt: this.lastCheckedAt, error: this.error, status: this.error ? 'disconnected' : this.lastCheckedAt ? 'following' : 'connecting' }; }
    async start() {
        try {
            this.checkpoint = JSON.parse(await readFile(this.path, 'utf8'));
            if (this.checkpoint.config !== this.identity())
                throw Error('Source mission configuration differs from the saved baseline. Use a new data directory to arm another source.');
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
        }
        await this.tick();
        this.loop();
    }
    identity() { return JSON.stringify({ origin: this.config.origin, sourceMission: this.config.sourceMission, targetMission: this.config.targetMission, bandNumber: this.config.bandNumber }); }
    loop() { if (!this.stopped)
        this.timer = setTimeout(() => { this.running = this.tick().finally(() => { this.running = undefined; this.loop(); }); }, this.config.intervalMs ?? 1000); }
    async close() { this.stopped = true; clearTimeout(this.timer); await this.running; }
    async tick() {
        try {
            const response = await fetch(`${this.config.origin}/api/incidents/${this.config.sourceMission}`, { redirect: 'error', signal: AbortSignal.timeout(4000) });
            if (!response.ok)
                throw Error(`Source mission returned HTTP ${response.status}.`);
            const source = await response.json();
            if (source.id !== this.config.sourceMission || !Array.isArray(source.observations) || !Array.isArray(source.reportJobs))
                throw Error('Source mission snapshot is invalid.');
            if (!this.checkpoint) {
                // Include unfinished jobs at arm time: old audio finishing later is not new speech.
                const baseline = { config: this.identity(), baselineAt: new Date().toISOString(), observations: source.observations.map(o => o.id), jobs: source.reportJobs.map(j => j.id), imported: 0 };
                await saveDispatchFile(this.path, baseline);
                this.checkpoint = baseline;
            }
            else
                for (const o of source.observations) {
                    const checkpoint = this.checkpoint;
                    if (checkpoint.observations.includes(o.id))
                        continue;
                    const job = source.reportJobs.find(j => j.observationId === o.id);
                    if (!job || checkpoint.jobs.includes(job.id) || job.status !== 'complete' || job.result === 'silence' || job.mode !== 'gemini' || o.mode !== 'gemini' || !o.factsReady || o.processing !== 'complete')
                        continue;
                    if (!['vexo-audio', 'vexo-transcript'].includes(o.inputKind) || job.inputKind !== o.inputKind)
                        continue;
                    const parsedDevice = sourceDeviceSchema.safeParse(o.sourceDevice), parsedJobDevice = sourceDeviceSchema.safeParse(job.sourceDevice);
                    if (!parsedDevice.success || !parsedJobDevice.success)
                        continue;
                    const device = parsedDevice.data, jobDevice = parsedJobDevice.data;
                    if (device.bandNumber !== this.config.bandNumber || JSON.stringify(device) !== JSON.stringify(jobDevice))
                        continue;
                    z.string().uuid().parse(o.id);
                    z.string().min(1).max(4000).parse(o.text);
                    z.string().min(1).max(80).parse(o.speaker);
                    const facts = z.array(factSchema).max(12).parse(o.facts);
                    await this.store.acceptRecord(this.config.targetMission, o.speaker, o.text, 'gemini', o.inputKind, o.id, device, undefined, { origin: { missionId: source.id, observationId: o.id }, facts });
                    const next = { ...checkpoint, observations: [...checkpoint.observations, o.id], jobs: [...checkpoint.jobs, job.id], imported: checkpoint.imported + 1 };
                    await saveDispatchFile(this.path, next);
                    this.checkpoint = next;
                }
            this.lastCheckedAt = new Date().toISOString();
            this.error = undefined;
        }
        catch (error) {
            this.error = error instanceof Error ? error.message : 'Source mission is unavailable.';
        }
    }
}
