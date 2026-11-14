import { z } from "zod";
const common = {
    id: z.string().uuid(), runId: z.string().uuid(), missionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    acceptedAt: z.string().datetime(), destination: z.literal("Relay Test Desk"), test: z.literal(true),
};
export const ticketReceiptSchema = z.object({ ...common, kind: z.literal("ticket"), title: z.string().min(1).max(160), detail: z.string().min(1).max(1000).optional() }).strict();
export const followUpReceiptSchema = z.object({ ...common, kind: z.literal("follow_up"), sourceReceiptId: z.string().uuid(), message: z.string().min(1).max(400) }).strict();
export const followUpMessage = (ticket) => `Ticket ${ticket.id} accepted for “${ticket.title}”. Follow-up recorded by Dispatcher B.`;
