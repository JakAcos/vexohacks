import { z } from "zod";
export const incidentIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const sourceDeviceSchema = z.object({
    kind: z.literal("vexo"), bandNumber: z.number().int().min(1).max(999),
    transport: z.enum(["ble", "serial"]), capturedAt: z.string().datetime(),
}).strict();
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
export const externalProposalInput = z.object({
    incidentId: incidentIdSchema,
    proposedBy: z.string().trim().min(1).max(80),
    kind: z.enum(["service_request", "team_update"]),
    service: z.enum(["ems", "fire", "police", "team"]),
    title: z.string().trim().min(1).max(120),
    detail: z.string().trim().min(1).max(1000),
    sourceObservationIds: z.array(z.string().uuid()).min(1).max(12),
    clientEventId: z.string().uuid().optional(),
}).strict().refine(v => (v.kind === "team_update") === (v.service === "team"), "team_update must target team; service_request must target ems, fire or police.");
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
