import { z } from "zod";

const common = {
  id: z.string().uuid(), runId: z.string().uuid(), missionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  acceptedAt: z.string().datetime(), destination: z.literal("Relay Test Desk"), test: z.literal(true),
};
export const ticketReceiptSchema = z.object({ ...common, kind: z.literal("ticket"), title: z.string().min(1).max(160), detail:z.string().min(1).max(1000).optional() }).strict();
export const followUpReceiptSchema = z.object({ ...common, kind: z.literal("follow_up"), sourceReceiptId: z.string().uuid(), message: z.string().min(1).max(400) }).strict();
export type TicketReceipt = z.infer<typeof ticketReceiptSchema>;
export type FollowUpReceipt = z.infer<typeof followUpReceiptSchema>;
export const followUpMessage = (ticket: TicketReceipt) => `Ticket ${ticket.id} accepted for “${ticket.title}”. Follow-up recorded by Dispatcher B.`;
export type DispatchRun = {
  id: string; missionId: string; title: string; createdAt: string; updatedAt: string;
  status: "submitting" | "following_up" | "complete" | "failed";
  destination: string; ticket?: TicketReceipt; followUp?: FollowUpReceipt; error?: string;
  browserEvidence?: { method: "browser_form"; agentId: string; browserPid: number; windowId: number; capturedAt: string; beforeSha256: string; afterSha256: string; receiptId: string };
  events: { worker: "coordinator" | "dispatcher_a" | "dispatcher_b"; message: string; timestamp: string }[];
};
export type DispatchSnapshot = { executionMode?: "browser_form" | "http"; enabled: boolean; destination?: string; runs: DispatchRun[] };
