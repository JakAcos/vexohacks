# Relay private cloud demo

Prepared by Codex on November 14, 2026. This is a deployment candidate, not a running cloud service.

## What is ready

The existing Relay app now has an explicit HTTPS origin, a private demo login, authenticated API and live event stream, an authenticated Vexo bridge, and a single-server container deployment with persistent mission storage. No Gemini key is shipped to browsers or wearable clients. The local demo and cloud deployment share the integrated background-processing code. The runtime owner controls local upgrades and preserves mission data.

The app permits one shared demo credential, not separate dispatcher/responder permissions. Use fictional incidents. Service connectors remain simulated. This package is for a private hackathon demonstration, not operational emergency dispatch.

## What is verified

Integration checks on November 14, 2026 passed 51 Node tests and 19 Python tests, with one optional SDK-import check skipped. The application build passed. These checks cover durable acceptance, background processing, private access, the bridge transport contract, retries, persistence and simulated receipts.

A live Gemini check saved and acknowledged one fictional typed report in 38 ms, answered a briefing request while AI was running in 17 ms, and completed three actions in about 13.6 seconds. A separate authenticated check acknowledged in 27 ms and completed three actions in about 10.4 seconds, including independent live-stream observation and duplicate-free retries during and after processing. These are individual local-server measurements, not latency guarantees or hosted acceptance.

Browser checks covered saving, concurrent reports, failure retry and simulated approvals. A disposable server was killed after acceptance and recovered the saved report on restart. Physical wearable evidence is separate: a prior bounded band-38 capture reached Gemini and produced source-linked EMS/team actions; continuous-session acceptance is tracked by the hardware owner.

No cloud host has been provisioned. The container image, reverse proxy, DNS and TLS issuance must be exercised on the selected host before the cloud demo is called ready. Run the smoke script below against the actual destination and retain its output with that deployment's build identity.

## Deploy on the chosen server

Use one Linux host with Docker Engine and the Compose plugin. It needs a DNS hostname pointing to it and inbound TCP ports 80 and 443. Only the gateway publishes ports; the application stays on the internal container network. Do not start multiple Relay replicas against the same mission data volume.

1. Extract this package on the host.
2. Copy `cloud.env.example` to `cloud.env`, then set file permissions to `600`.
3. Set `RELAY_DOMAIN` to that hostname. Fill in the existing Gemini key and verified model privately. Generate the Relay password with `openssl rand -hex 32` and store it as `RELAY_ACCESS_TOKEN`. Never use the Gemini key as the Relay password. Do not paste secrets into chat, commit them, or add them to URLs.
4. Start and verify:

```sh
docker compose --env-file cloud.env config --quiet
docker compose --env-file cloud.env up -d --build
docker compose --env-file cloud.env ps
```

Open `https://YOUR_HOST/?incidentId=stage-demo`. The browser login is username **relay**, password **RELAY_ACCESS_TOKEN**. Sign in before projecting the screen. Every participant uses the same hostname and incident ID. Only `/healthz` is public and it returns a minimal liveness response.

Caddy provides the HTTPS gateway and forwards the app's event stream. Credentials are passed to the application at runtime, not baked into the image.

The `mission-data` Docker volume retains reports and receipts across container replacement. Preserve it when upgrading. **Do not run `docker compose down -v`** unless deliberately deleting the demo's saved mission data. This is single-host persistence, not a database backup or multi-region service.

## Verify the actual cloud address

From a Node 24+ laptop, set `COPILOT_URL` to the HTTPS origin and `RELAY_ACCESS_TOKEN` privately in the environment, then run:

```sh
node scripts/cloud-smoke.mjs
```

This sends one typed fictional report to Gemini, checks three source-linked actions, approves the simulated requests, verifies a second live subscription and checks duplicate-free retries. Each run creates its own `stage-check-…` mission. It never opens a microphone or contacts real emergency services. It exits unsuccessfully if any required check fails. Keep its output as the hosted acceptance evidence.

Before the show, also open the same mission on a second device on a different network and confirm its live feed. Restart the hosted application once and confirm that its saved reports and receipts remain. These are still pending.

## Connect band 38

The bridge runs on the laptop near the band. The app’s Start band control requires that local runtime with Python and the Vexo SDK. The provided cloud container deliberately contains neither Python nor the hardware SDK/scripts, so use the laptop bridge command to send to the cloud; starting a band from the hosted dashboard is not supported by this container. The Vexo phone app is not required by this direct SDK path. Close other clients using the band to avoid connection contention. Physical band 38 capture remains a separate acceptance test.

In the bridge's ignored local `.env`, retain the assigned `VEXO_BAND_NUMBER=38` and the existing `VEXO_KIT_PATH`. Set `COPILOT_URL` to the chosen HTTPS origin and `RELAY_ACCESS_TOKEN` to the private demo password. The bridge requires TLS for remote servers, verifies the TLS certificate, sends its password in a header and refuses redirects. Its durable queue is scoped to the destination and mission, so changing servers does not silently forward an old queue elsewhere.

Follow `VEXO_LIVE_BRIDGE.md` for SDK installation, exact-band verification and explicit microphone consent. Then use the approved capture command with `--incident-id stage-demo`. The laptop microphone in the Relay page is the fallback. Briefings play through the laptop: the band has no verified speaker path.

## Next decision

Choose and connect a cloud hosting account and hostname. No host, paid service, DNS change or public endpoint was created by this task. Once the destination is available, deploy this package and run the hosted acceptance check above before presenting it as cloud-hosted orchestration.
