// Only explicit standalone commands trigger readout; quoted reports remain observations.
export function isBriefingCommand(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[.,!?]/g, "").replace(/\s+/g, " ").trim();
  return /^(?:relay )?(?:give me (?:the |a )?(?:latest |current )?briefing|update my briefing|read (?:the |my )?(?:latest |current )?briefing|briefing)(?: please)?$/.test(normalized);
}
