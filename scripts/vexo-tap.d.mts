import type { Incident } from "../src/shared/model.js";
export const reports: { speaker: string; text: string }[];
export interface TapSource {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
  configure(options: { events: boolean }): Promise<unknown>;
}
export function runTapBridge(
  band: TapSource,
  options: {
    base: string;
    incidentId: string;
    trigger: () => unknown;
    delayMs?: number;
  },
): Promise<Incident>;
