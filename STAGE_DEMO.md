# One report, one shared mission, three actions

Prepared by Codex for rehearsal. Proposed stage flow; not a claim of completed physical-band or hosted acceptance.

Project one Relay mission dashboard. A teammate opens that same mission on a second device before the presentation. Keep setup screens, passwords and technical consoles off the projector.

**Opening:** “Responders each see part of an incident. Relay keeps a shared picture and turns one report into coordinated requests.”

**Say once:** “Smoke coming from the second floor. Request an ambulance for two injured people. Request police for traffic control. Share the smoke report with the mission team.”

**Show:** The attributed report appears immediately with a saved/processing status. While the mission stays usable, Relay creates an EMS request, a police request and a team update. The team update appears automatically; the dispatcher reviews and approves the two service requests. The acknowledgments stay beside the source report. Local Gemini rehearsals took about 10–14 seconds to finish the actions after immediate acceptance, so explain the shared context while processing continues. These are observations from individual tests, not a speed guarantee.

**Explain while it runs:** “That single report becomes shared context, two proposed service requests and an update everyone on this mission can see.”

**Close:** “The dispatcher remains in control. Everyone sees the same report, decisions and receipts.”

Call the service desks simulated. The actual message transport is the shared dashboard's live event stream; no SMS, radio or real unit dispatch is connected.

The intended transport is **band 38 → laptop bridge → HTTPS cloud server → Gemini → shared mission and dispatcher screen**. The bridge uses the Vexo SDK directly; it does not require the Vexo phone app. Use the laptop microphone if physical capture is not verified. If using typed rehearsal input, label it as typed.

Readiness gate: prove one complete report from the chosen live input through the hosted server to the second device, then rehearse the same flow once on the stage network. A local server calling Gemini proves cloud AI reasoning, not cloud-hosted orchestration.
