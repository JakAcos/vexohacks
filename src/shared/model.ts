import { z } from "zod";
export const incidentIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const observationInput = z
  .object({
    incidentId: incidentIdSchema,
    speaker: z.string().trim().min(1).max(80),
    text: z.string().trim().min(1).max(4000),
    inputKind: z
      .enum(["typed", "transcript", "vexo-simulated-text"])
      .default("typed"),
  })
  .strict();
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
export interface Observation {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  mode: Mode;
  inputKind: "typed" | "transcript" | "vexo-simulated-text";
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
  id: string;
  title: string;
  version: number;
  observations: Observation[];
  issues: Issue[];
  briefings: Briefing[];
  handovers: Handover[];
  updatedAt: string;
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
