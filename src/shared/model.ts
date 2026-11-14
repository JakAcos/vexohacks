import { z } from "zod";
import type { TicketReceipt, FollowUpReceipt } from "./test-dispatch.js";
export const incidentIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const sourceDeviceSchema = z.object({
  kind: z.literal("vexo"), bandNumber: z.number().int().min(1).max(999),
  transport: z.enum(["ble", "serial"]), capturedAt: z.string().datetime(),
}).strict();
export type SourceDevice = z.infer<typeof sourceDeviceSchema>;
export const observationInput = z
  .object({
    incidentId: incidentIdSchema,
    speaker: z.string().trim().min(1).max(80),
    text: z.string().trim().min(1).max(4000),
    clientEventId: z.string().uuid().optional(),
    sourceDevice: sourceDeviceSchema.optional(),
    inputKind: z
      .enum(["typed", "transcript", "vexo-simulated-text", "vexo-audio", "vexo-transcript"])
      .default("typed"),
  })
  .strict().refine(value => Boolean(value.sourceDevice) === ["vexo-audio", "vexo-transcript"].includes(value.inputKind), "Physical Vexo input needs device metadata; other sources must not claim it.");
export const factSchema = z
  .object({
    topic: z.enum(["smoke", "rear-entrance", "occupant", "other"]),
    label: z.string().min(1).max(300),
    status: z.enum(["reported", "resolved", "contradiction"]),
    source: z.enum(["speaker", "resident"]),
    uncertain: z.boolean(),
  })
  .strict();
export const extractionSchema = z
  .object({ facts: z.array(factSchema).max(12) })
  .strict();
export type Fact = z.infer<typeof factSchema>;
export type Mode = "demo" | "gemini";
export interface ReportJob {
  captureMode?: "continuous"; result?: "silence";
  id: string; clientEventId?: string; speaker: string; mode: Mode;
  inputKind: Observation["inputKind"]; sourceDevice?: SourceDevice;
  observationId?: string; briefingId?: string;
  status: "queued" | "transcribing" | "extracting" | "planning" | "complete" | "failed";
  submittedAt: string; completedAt?: string; error?: string;
  audio?: { contentType: string; provider: "gemini" | "deepgram"; sha256: string };
  timings: { transcriptionMs?: number; extractionMs?: number; planningMs?: number; totalMs?: number };
}
export interface Observation {
  importedFrom?: { missionId: string; observationId: string };
  processing?: ReportJob["status"];
  factsReady?: boolean;
  id: string;
  clientEventId?: string;
  sourceDevice?: SourceDevice;
  speaker: string;
  text: string;
  timestamp: string;
  mode: Mode;
  inputKind: "typed" | "transcript" | "vexo-simulated-text" | "vexo-audio" | "vexo-transcript";
  processingMs: number;
  facts: Fact[];
}
export interface Evidence {
  observationId: string;
  source: string;
  timestamp: string;
  status: Fact["status"];
  label: string;
  uncertain: boolean;
}
export interface Issue {
  id: string;
  topic: Fact["topic"];
  label: string;
  status: "active" | "resolved" | "conflicting";
  uncertain: boolean;
  evidence: Evidence[];
}
export interface Briefing {
  id: string;
  text: string;
  timestamp: string;
  revision: number;
  stateVersion: number;
}
export interface Handover extends Briefing {
  approvedAt?: string;
  approvedBy?: string;
  supersededAt?: string;
}
export interface Incident {
  reportJobs?: ReportJob[];
  revision?: number;
  id: string;
  title: string;
  version: number;
  observations: Observation[];
  issues: Issue[];
  briefings: Briefing[];
  handovers: Handover[];
  actions: MissionAction[];
  agentEvents: AgentEvent[];
  voiceCommands: {clientEventId: string; speaker: string; transcript: string; briefingId: string}[];
  updatedAt: string;
}
export interface MissionAction {
  id: string;
  kind: "service_request" | "team_update" | "test_request" | "test_follow_up";
  service: "ems" | "fire" | "police" | "team" | "test_desk";
  title: string;
  detail: string;
  sourceObservationIds: string[];
  status: "proposed" | "acknowledged" | "dismissed" | "queued" | "executing" | "failed";
  createdAt: string;
  updatedAt: string;
  approvedBy?: string;
  receipt?: { id: string; service: string; message: string; timestamp: string; simulated: true };
  testExecution?: {
    destination: string; plannedVersion: number; planner: "gemini";
    phase: "queued" | "submitting" | "planning_follow_up" | "following_up" | "complete" | "failed" | "cancelled";
    ticket?: TicketReceipt; followUp?: FollowUpReceipt;
    followUpActionId?: string; parentActionId?: string; sourceReceiptId?: string;
    error?: string;
  };
}
export interface AgentEvent {
  id: string;
  agent: "coordinator" | "dispatcher" | "service";
  actionId?: string;
  message: string;
  timestamp: string;
}
export const scenario = [
  {
    speaker: "Firefighter A",
    text: "Smoke coming from the second floor. A resident reports someone may still be upstairs.",
  },
  { speaker: "Firefighter B", text: "Rear entrance is blocked." },
  {
    speaker: "Firefighter B",
    text: "The resident has located the missing person outside. The resident reports nobody else is missing.",
  },
];
