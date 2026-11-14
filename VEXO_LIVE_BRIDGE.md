# Mission-long continuous listening

Use **Start mission listening** in the local Relay app after double-tapping the assigned band. **Stop band listening** disables its microphone and finishes saving received audio. The session stays bound to its mission and selected speaker; it does not identify individual voices automatically. Nearby people must agree to recording and transmission to Gemini.

Continuous mode preserves every received PCM frame. It prefers a pause after 12 seconds and sends at 20 seconds at the latest; no amplitude threshold decides which speech to keep. Gemini processing runs independently after the server durably accepts each segment. Empty continuous transcripts finish as silence without creating an observation or stopping listening. The app shows intake and AI processing separately. Agent service requests remain proposals for human review; team-feed delivery is simulated.

The local bridge retains unacknowledged segments under the mission's outbox with stable IDs. **Retry saved reports** resends that queue without connecting to a microphone. Same-band Bluetooth reconnection is supported; audio gaps are surfaced and cannot be reconstructed. When delivery falls far behind, the bridge stops before its bounded outbox fills. The controller watchdog switches capture off if the server exits. Restarting the app does not silently restart recording.

CLI equivalent (Gemini backend already running):

```sh
python scripts/vexo-live.py --capture-mode continuous --provider gemini --incident-id vexo38-live --speaker 'Firefighter A' --confirm-capture
```

Continuous mode's `--seconds 0` default runs until Stop/Ctrl+C. `--continuous-seconds` selects the maximum segment length (12–60 seconds, default 20). Use `--drain-only` with the original mission/speaker/outbox to retry saved audio without hardware. The default CLI mode remains bounded for compatibility with explicit short tests.

Validation so far: 20 minutes of synthetic PCM preserved all samples with bounded memory; 16 Python bridge tests and the combined backend suite passed. This is not evidence of a multi-hour physical-band soak test.

# Verified bounded voice reports (November 14)

The default physical Gemini path is now a bounded report. Specify `--seconds 45` (1–120 seconds supported). It preserves all decoded audio until microphone stop, then submits one WAV; room-noise calibration cannot discard the report. Keep the band near the speaker and wait for `microphone_capture_started`. No other band client should run.

Use `--diagnostic-dir <private-directory>` to retain the actual WAV and packet/sample/level measurements. These recordings are private local test evidence: never put them in Git or the handoff ZIP. `VEXO_STATUS_FILE` optionally names a local status JSON file for a prompt recording cue. Delivery continues after the microphone switches off; unacknowledged reports retain their UUID in the outbox.

The earlier continuous heuristic remains available only with `--capture-mode vad`; it is not verified for noisy-room speech. The bounded mode is the verified hackathon path, not a claim of an unattended multi-hour band session.

Real band 38 testing completed: 45 seconds received 2,246 packets with no gaps; a separately authorized 15-second spoken request received 746 packets with no gaps and produced a saved Gemini observation, a proposed EMS request, and an acknowledged simulated team update. No real dispatch occurred. Gemini misheard the opening band identifier but captured the service request. The band has no speaker; spoken replies play on the computer.

# Physical Vexo speech bridge

`python3 scripts/vexo-live.py` forwards the **assigned physical band's** microphone to the existing mission backend. This is separate from `vexo-bridge.mjs`, whose simulator releases scripted text.

## Verified status

- Actual SDK imports and its Opus-to-PCM decoder have been exercised against the kit's bundled recording, with **no band connection** in those tests.
- Nine bridge tests cover segmentation, WAV encoding, durable queue identity/permissions, retries, local HTTP contracts, and refusal to connect without a number.
- Physical band **38** now passed bounded capture, Gemini transcription, mission persistence and source-linked simulated agent actions. Bluetooth reconnect and unattended continuous capture remain unverified.
- The shared backend/runtime is owned by the speech integration chat; this bridge does not build or restart it.

## Setup

Run from the repository root. Use Python 3.10 or newer; the local dependency/import check was performed with Python 3.13, Bleak 3.1.0 and PyAV 19.0.2. On this Mac, the older system Python selected incompatible Bluetooth dependencies, so use the modern interpreter.

```sh
# Skip cloning if the unmodified official kit is already in this exact directory.
git clone https://github.com/VexoAI-Org/vexo-open-kit.git vexo-open-kit
python3.13 -m venv .venv-vexo
source .venv-vexo/bin/activate
python -m pip install -r scripts/vexo-live-requirements.txt
```

Run subsequent commands with that environment activated (Windows PowerShell: `.venv-vexo\Scripts\Activate.ps1`; use your installed modern Python executable to create it). Do not commit the virtual environment or Python bytecode.

The kit must remain unchanged. `VEXO_KIT_PATH` defaults to `./vexo-open-kit`. **The current canonical checkout already has the kit in the sibling `../vexo-open-kit`, so use this instead of cloning another copy:**

```sh
export VEXO_KIT_PATH=../vexo-open-kit
# Windows PowerShell: $env:VEXO_KIT_PATH = '../vexo-open-kit'
```

That setting changes only where the unchanged SDK is imported; it never changes the assigned band. Set it to a different existing official kit folder only when that is your chosen installation. Kit rules: [AGENTS.md](https://github.com/VexoAI-Org/vexo-open-kit/blob/main/AGENTS.md), [Python audio interface](https://github.com/VexoAI-Org/vexo-open-kit/blob/main/docs/speech.md).

The single band-number setting is **`VEXO_BAND_NUMBER` in the ignored project `.env` or process environment**. Dante supplied 38 for this team; it has been set locally without changing keys. The bridge has no fallback number and no band-number command-line argument. An environment variable, even an empty one, takes precedence over `.env`.

`COPILOT_URL` defaults to `http://127.0.0.1:3001`. Only a loopback HTTP origin is allowed; redirects and configured HTTP proxies are not used. Keep the backend running separately. Gemini audio uses the backend's configured Gemini key/model; no Gemini key is read by this bridge.

```sh
# Imports/prerequisites only. No band constructed, scanned or connected.
python scripts/vexo-live.py --check

# Actual assigned-band connection, then disconnect. Microphone remains OFF.
python scripts/vexo-live.py --connect-check
```

Before a real connect, close the kit dashboard and any other program using this band's Bluetooth/USB. Double-tap the assigned band: its blue discoverable blink lasts 60 seconds. If the SDK cannot find it, check that band and retry; never try another attendee's number.

## Bounded Gemini audio input

Tell nearby people that the microphone records them and sends sound to Gemini, and obtain their agreement. Keep its solid blue recording light visible. Importing the script or running `--check` never records.

```sh
python scripts/vexo-live.py --provider gemini --incident-id apartment-demo --speaker 'Firefighter A' --confirm-capture --seconds 45
```

The bridge verifies the configured band and transport, loads the official Opus decoder before recording, and retains all received 16-kHz mono PCM for the chosen duration. Start speaking at `microphone_capture_started`; no quiet calibration is needed. At stop it disables the microphone and disconnects before waiting for Gemini delivery. The durable WAV uses one stable event ID across retries. Delivery can continue for up to 130 seconds after microphone stop; unacknowledged reports remain in the outbox.

`--capture-mode vad` explicitly enables the older continuous heuristic: one-second background calibration, threshold at three times median RMS, 300-ms pre-roll, and pause/max-duration segmentation. That mode discarded all reports during earlier noisy-room trials and is not the verified demo path. Its `--threshold-ratio` accepts 1.5–10 and `--maximum-seconds` accepts 2–15. Only in this legacy mode may `--seconds` be omitted to run until Ctrl+C.

## Optional kit Deepgram streaming

```sh
python scripts/vexo-live.py \
  --provider deepgram \
  --capture-mode vad \
  --speaker 'Firefighter A' \
  --incident-id apartment-demo \
  --confirm-capture
```

This uses the kit's existing `examples/python/speech.py` helper, not a second transcription client. The helper reads the team's `DEEPGRAM_API_KEY` from the environment or ignored project `.env`, preserves `mip_opt_out=true`, and prints its disclosure before audio is sent. Do not put a key in a command argument or source file. The backend still needs its own configured model for coordination.

Only settled **whole-sentence** final callbacks are forwarded to `/api/voice/turn`; partial transcription guesses are never committed. A failed speech stream stops capture with an explicit log. Already-finalized turns remain buffered; unfinished recognition during a lost link cannot be recovered or claimed as heard. Deepgram's actual account/service path has not been exercised by this bridge.

For a USB data cable use `--transport serial` and install `pyserial` in the same environment. The bridge still passes the exact assigned number and checks the returned identity; it never uses the library's `None`/“whatever is attached” connection form.

## Physical provenance contract

Metadata is attached only after the actual SDK band number and physical transport match the assigned configuration. It is **bridge-reported provenance**, not backend proof of hardware. Simulated input is never relabeled physical.

- Audio query: `inputKind=vexo-audio`, `bandNumber=<assigned number>`, `deviceTransport=ble|serial`, `capturedAt=<UTC ISO time ending Z>`, alongside `incidentId`, `speaker`, `provider=gemini`, `consent=send-to-gemini`, and stable `clientEventId`. Body: raw WAV, `Content-Type: audio/wav`.
- Final transcript JSON: `{incidentId, speaker, text, clientEventId, inputKind: "vexo-transcript", sourceDevice: {kind: "vexo", bandNumber, transport: "ble"|"serial", capturedAt}}`.
- Backend persisted observation: `inputKind` plus `sourceDevice`. It validates the assigned `VEXO_BAND_NUMBER` and the allowed transport. `capturedAt` is the bridge's clip/finalization timestamp, not a calibrated acoustic onset time.

The backend owns transcription, context, coordination and command deduplication. The bridge supplies the same `clientEventId` for every retry of one captured turn. It does not issue operational decisions, dispatch messages, or play TTS. Dashboard/voice-console owners handle spoken responses on an appropriate computer audio device; the band has no speaker.

## Buffering, stop and reconnect

The outbox lives under ignored `data/vexo-live/<identity hash>/`. Its identity includes the exact band, backend origin, incident, speaker and provider; different identities cannot reuse each other's pending queue. Each JSON record contains a stable UUID and a transcript or base64 WAV, saved with owner-only file permissions. **These files contain speech data.** Successful 2xx JSON acknowledgement deletes that record; pending recordings remain until the same run configuration retries them or the operator deliberately reviews/removes them.

- Strict FIFO delivery: a failed first turn stays ahead of later ones, preserving report order.
- Offline/network errors, HTTP 408/425/429 and 5xx use backoff capped at ten seconds. Backend request timeout is 120 seconds for transcription/extraction/coordination. No alternative provider is selected silently.
- Other rejected requests stop capture and preserve the recording for human review. Check logs/backend state before retrying or deleting a rejected item.
- The durable queue holds at most 32 turns; the Opus packet buffer holds five seconds. Filling either stops capture explicitly; it never silently discards old context.
- Bounded mode stops on disconnection and retains received PCM; it does not reconnect or extend the authorized capture window. Only legacy VAD mode can reconnect to the **same** number for up to 120 seconds. Pending completed turns survive. A reconnect, packet gap or stream takeover is logged. In legacy VAD mode, unfinished audio across gaps is discarded, not stitched into a report. Bounded mode retains the received portions and reports packet gaps explicitly. The operator must repeat that report after quiet recalibration. A stream taken by another program stops capture; this bridge does not automatically seize it back.
- A normal stop releases its outbox lock. A force-killed process can leave `.bridge.lock/owner.json`; confirm that its recorded PID has exited before manually removing that one stale lock directory. Never clear a live process's lock or another identity's queue.

Logs are JSON metadata: connection/reconnect/stop events, queued UUIDs, acknowledgements and numeric HTTP status. They contain no API keys, provider bodies, transcripts or recording bytes. No microphone audio is stored on the band.

## Bridge-only verification

These tests do not connect a physical or simulated band and do not call a cloud provider:

```sh
PYTHONDONTWRITEBYTECODE=1 VEXO_KIT_PATH=./vexo-open-kit \
  python -m unittest discover -s tests -p test_vexo_live.py -v
```

The optional actual-decoder check reads the kit's bundled public-domain audio and replaces `Band.connect` with a failing guard. Segmentation tests use synthetic PCM. The local HTTP fixture validates attribution, provenance, UUID and consent shape; it does not establish real speech recognition or hardware behavior. Real band availability, capture quality, Bluetooth recovery and speech-to-mission latency remain separate acceptance checks.
