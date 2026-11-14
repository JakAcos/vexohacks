# Relay — VexoHacks submission

Prepared by Codex for team review, November 14, 2026. This snapshot contains reviewed product source, reproducible browser/server builds, setup instructions, tests and a clearly labeled software-demo video. It excludes credentials, captured speech, mission stores, outboxes, private Git history and dependency folders. The demo contains only fictional input and one sanitized historical receipt.

[Watch the labeled software demo](demo/Relay-Software-Demo-V1.mp4). The video includes a clearly marked historical physical-test receipt.

## Product
Relay keeps responder reports, shared incident context and reviewable actions together. Vexo supplies wearable input; Gemini can transcribe, extract and propose actions. Team updates are automatic; service requests wait for human review. Service execution is simulated.

## Run
Use Node.js 24 or newer. Run `npm ci`, `npm run build`, and `npm start`, then open the local address in README.md. Demo mode works without provider credentials. Configure live Gemini privately as documented. The physical bridge has separate Python/SDK prerequisites.

## Verified package
58 packaged Node tests passed. The previous unchanged bridge/test files passed 19 Python tests with one optional hardware-SDK check skipped. A fresh install reproduces all 17 browser/server files byte-for-byte. Synthetic saved reports and simulated receipts survive duplicate input and server restart, including coexistence with legacy band-controller metadata. The final local band-38/Gemini flow also passed independent acceptance at 1:52 PM Pacific, including source-linked simulated approval and receipt persistence. One earlier follow-up was not recognized and was not counted as a pass. Hosted deployment, stage network and long-duration capture are separate checks.

## Event delivery
Organizer slides require public GitHub + README, video demo and Devpost submission before 6 PM Pacific on November 14, plus a working in-person demo. A local ZIP is not a submitted entry. Repository publication and Devpost submission were authorized by Dante on November 14, 2026. Submission completion is verified separately on Devpost.

Organizer slides: https://docs.google.com/presentation/d/1WfolIHSbiYNbzTfdFW26vU3bxyHt2O9NPFA8HRCGcq0

## Sponsor-track accuracy
The verified runtime uses gemini-3.5-flash. The listed Google award is Best Use of Gemini 4; eligibility for that track is not established. Do not describe this tested build as using Gemini 4.
