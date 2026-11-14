#!/usr/bin/env python3
"""Physical Vexo microphone bridge. Import/check mode never connects a band."""
import argparse
import array
import base64
from collections import deque
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import queue
import re
import signal
import statistics
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave

sys.dont_write_bytecode = True


def log(event, **fields):
    # Never log keys, raw provider responses, recordings or recognized words.
    print(json.dumps(dict(at=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), event=event, **fields)), flush=True)
    status = os.environ.get('VEXO_STATUS_FILE')
    if status:
        path = Path(status)
        temp = path.with_suffix('.%s.part' % threading.get_ident())
        temp.write_text(json.dumps(dict(event=event, **fields)))
        temp.replace(path)


def settings():
    values = {}
    path = Path('.env')
    if path.is_file():
        for line in path.read_text().splitlines():
            name, separator, value = line.strip().removeprefix('export ').partition('=')
            if separator and name.strip() in ('VEXO_BAND_NUMBER', 'VEXO_KIT_PATH', 'COPILOT_URL', 'RELAY_ACCESS_TOKEN'):
                values[name.strip()] = value.strip().strip('\"\'')
    return {name: os.environ.get(name, values.get(name, default)) for name, default in (
        ('VEXO_BAND_NUMBER', ''), ('VEXO_KIT_PATH', './vexo-open-kit'), ('COPILOT_URL', 'http://127.0.0.1:3001'), ('RELAY_ACCESS_TOKEN', ''))}


def own_number(raw):
    if not re.fullmatch(r'\d{1,3}', raw or '') or not 1 <= int(raw) <= 999:
        raise ValueError('Set VEXO_BAND_NUMBER to the team number from the bag. No default or guessed band number is allowed.')
    return int(raw)


def local_url(value):
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1') or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('COPILOT_URL must be a loopback HTTP origin, without credentials or a path.')
    return value.rstrip('/')


def backend_url(value, token=''):
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme == 'http':
        return local_url(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in ('', '/') or len(token) < 32):
        raise ValueError('Remote COPILOT_URL requires an HTTPS origin and RELAY_ACCESS_TOKEN of at least 32 characters.')
    return value.rstrip('/')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never redirect captured audio to another service or computer.


class Backend:
    def __init__(self, origin, token=''):
        self.origin = backend_url(origin, token)
        self.headers = {'Authorization': 'Bearer ' + token} if token else {}
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.ProxyHandler({}))

    def health(self):
        with self.opener.open(urllib.request.Request(self.origin + '/api/health', headers=self.headers), timeout=10) as response:
            return json.load(response)

    def send(self, record):
        if record['kind'] == 'audio':
            query = urllib.parse.urlencode({name: record[name] for name in ('incidentId', 'speaker', 'clientEventId', 'provider')})
            source = record['sourceDevice']
            query += '&' + urllib.parse.urlencode({'consent':'send-to-' + record['provider'], 'inputKind':'vexo-audio',
                'bandNumber':source['bandNumber'], 'deviceTransport':source['transport'], 'capturedAt':source['capturedAt']})
            if record.get('captureMode') == 'continuous':
                query += '&captureMode=continuous'
            path = '/api/voice/audio?' + query
            body = base64.b64decode(record['audio'], validate=True)
            media = 'audio/wav'
        else:
            path = '/api/voice/turn'
            turn = {name:record[name] for name in ('incidentId','speaker','text','clientEventId','sourceDevice')}
            turn['inputKind'] = 'vexo-transcript'
            body = json.dumps(turn).encode()
            media = 'application/json'
        request = urllib.request.Request(self.origin + path, body, dict(self.headers, **{'Content-Type': media}), method='POST')
        with self.opener.open(request, timeout=120) as response:
            result = json.loads(response.read(8 * 1024 * 1024))
            if not isinstance(result, dict):
                raise ValueError('Unexpected backend response.')
            return result


class Outbox:
    """One owned directory; durable FIFO entries keep their UUID across retry/restart."""
    def __init__(self, directory, identity, maximum=32):
        self.directory = Path(directory)
        self.identity = identity
        self.maximum = maximum
        self.lock = threading.Lock()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lease = self.directory / '.bridge.lock'
        try:
            self.lease.mkdir(mode=0o700)
        except FileExistsError:
            raise ValueError('This outbox is already owned or has a lock from an interrupted run. See VEXO_LIVE_BRIDGE.md; do not start a second reader.') from None
        (self.lease / 'owner.json').write_text(json.dumps({'pid': os.getpid(), 'identity': identity}))
        try:
            for file in self.pending():
                self.read(file)  # Refuse mismatched/corrupt records instead of sending to another incident.
        except BaseException:
            self.close()
            raise

    def close(self):
        (self.lease / 'owner.json').unlink(missing_ok=True)
        self.lease.rmdir()

    def pending(self):
        return sorted(self.directory.glob('*.json'))

    def read(self, file):
        data = json.loads(file.read_text())
        if data.get('identity') != self.identity or data.get('kind') not in ('audio', 'text'):
            raise ValueError('Outbox record identity or format mismatch; nothing was sent.')
        uuid.UUID(data['clientEventId'])
        return data

    def append(self, kind, payload):
        with self.lock:
            if len(self.pending()) >= self.maximum:
                raise ValueError('Outbox is full. Capture stopped; existing unacknowledged turns are retained.')
            event_id = str(uuid.uuid4())
            data = dict(identity=self.identity, kind=kind, clientEventId=event_id,
                        capturedAt=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), **payload)
            file = self.directory / ('%020d-%s.json' % (time.time_ns(), event_id))
            temp = file.with_suffix('.part')
            descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'w') as handle:
                json.dump(data, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, file)
            log('turn_buffered', clientEventId=event_id, pending=len(self.pending()))
            return event_id

    def acknowledge(self, file):
        with self.lock:
            file.unlink(missing_ok=True)


def sender(outbox, backend, stop, fatal, capture_stop=None):
    failures = 0
    while not stop.is_set():
        pending = outbox.pending()
        if not pending:
            stop.wait(.2)
            continue
        file = pending[0]
        try:
            record = outbox.read(file)
            result = backend.send(record)
            kind = result.get('kind')
            if kind not in ('observation', 'briefing', 'action', 'silence', 'queued'):
                raise ValueError('Backend did not acknowledge the report.')
            outbox.acknowledge(file)
            failures = 0
            log('turn_acknowledged', clientEventId=record['clientEventId'], result=kind, pending=len(outbox.pending()))
        except urllib.error.HTTPError as error:
            # Do not echo upstream content or discard a rejected recording.
            if error.code in (408, 425, 429) or 500 <= error.code <= 599:
                failures += 1
                log('backend_retry', status=error.code, pending=len(outbox.pending()), retrySeconds=min(10, 2 ** min(failures - 1, 4)))
            else:
                log('backend_rejected', status=error.code, pending=len(outbox.pending()), action='capture stopped; recording retained for review')
                fatal.set(); stop.set();
                if capture_stop is not None: capture_stop.set()
                return
        except (urllib.error.URLError, TimeoutError, OSError):
            failures += 1
            log('backend_retry', pending=len(outbox.pending()), retrySeconds=min(10, 2 ** min(failures - 1, 4)))
        except (ValueError, KeyError, TypeError):
            log('backend_or_outbox_invalid', pending=len(outbox.pending()), action='capture stopped; recording retained')
            fatal.set(); stop.set();
            if capture_stop is not None: capture_stop.set()
            return
        if failures:
            stop.wait(min(10, 2 ** min(failures - 1, 4)))


class Utterances:
    """Calibrated RMS segmentation of decoded 16 kHz mono PCM; no speaker inference."""
    def __init__(self, emit, maximum_seconds=8, ratio=3.0):
        self.emit, self.maximum_seconds, self.ratio = emit, maximum_seconds, ratio
        self.reset()

    def reset(self):
        self.noise = []
        self.threshold = None
        self.pre = deque(maxlen=15)  # 300 ms pre-roll at the kit's 20 ms frame size.
        self.active = []
        self.quiet = 0
        self.voiced = 0

    def feed(self, pcm):
        # The SDK returns 320 samples for each complete 20 ms frame.
        if len(pcm) != 640:
            raise ValueError('Expected one decoded 20 ms mono PCM frame.')
        samples = array.array('h', pcm)
        if sys.byteorder != 'little':
            samples.byteswap()
        rms = math.sqrt(sum(value * value for value in samples) / len(samples))
        if self.threshold is None:
            self.noise.append(rms)
            if len(self.noise) == 50:
                self.threshold = max(30, statistics.median(self.noise)) * self.ratio
                log('calibration_ready', thresholdRms=round(self.threshold), note='prototype relative threshold; quiet room calibration required')
            return
        voiced = rms > self.threshold
        if not self.active:
            if not voiced:
                self.pre.append(pcm)
                return
            self.active = list(self.pre)
            self.pre.clear()
        self.active.append(pcm)
        self.voiced += int(voiced)
        self.quiet = 0 if voiced else self.quiet + 1
        if self.quiet >= 40 or len(self.active) >= int(self.maximum_seconds * 50):
            self.flush()

    def flush(self):
        if self.active and self.voiced >= 10:  # Ignore <200 ms clicks; not a validated speech classifier.
            buffer = io.BytesIO()
            with wave.open(buffer, 'wb') as wav:
                wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                wav.writeframes(b''.join(self.active))
            self.emit(buffer.getvalue())
        self.active = []
        self.quiet = self.voiced = 0
        self.pre.clear()


class BoundedReport:
    """Retain an explicitly bounded spoken report without a room-noise gate.

    VAD is measured in shadow mode only: its threshold must never erase this report.
    """
    def __init__(self, emit, seconds, directory=None):
        self.emit = emit
        self.limit = int(seconds * 50) + 50
        self.frames = []
        self.levels = []
        self.peak = 0
        self.old_clips = 0
        self.directory = Path(directory) if directory else None
        self.shadow = Utterances(self.old_emit)

    def old_emit(self, _):
        self.old_clips += 1

    def reset(self):
        # A transport boundary resets the decoder/VAD, never already received PCM.
        self.shadow.reset()

    def feed(self, pcm):
        if len(pcm) != 640 or len(self.frames) >= self.limit:
            raise ValueError('Invalid frame or bounded report duration exceeded.')
        samples = array.array('h', pcm)
        if sys.byteorder != 'little': samples.byteswap()
        self.frames.append(pcm)
        self.levels.append(math.sqrt(sum(x*x for x in samples)/len(samples)))
        self.peak = max(self.peak, max(map(abs, samples)))
        self.shadow.feed(pcm)
        if len(self.frames) % 250 == 0:
            log('audio_progress', decodedFrames=len(self.frames), pcmSamples=len(self.frames)*320,
                peak=self.peak, recentRms=round(statistics.median(self.levels[-250:])))

    def flush(self):
        if not self.frames: return
        self.shadow.flush()
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(self.frames))
        payload = buffer.getvalue()
        stats = dict(decodedFrames=len(self.frames), pcmSamples=len(self.frames)*320,
            audioSeconds=len(self.frames)/50, peak=self.peak,
            medianRms=round(statistics.median(self.levels)), maximumRms=round(max(self.levels)),
            oldGateClips=self.old_clips, oldThresholdRms=round(self.shadow.threshold or 0), wavBytes=len(payload))
        if self.directory:
            self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            for name, content in [('capture.wav', payload), ('metrics.json', json.dumps(stats).encode())]:
                with os.fdopen(os.open(self.directory/name, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600), 'wb') as handle:
                    handle.write(content)
        log('bounded_report_ready', **stats)
        self.emit(payload)
        self.frames.clear()


class ContinuousReports:
    """Every received sample is delivered once; energy chooses cuts, never inclusion.

    Prefer a pause after 12 seconds, force a cut at the configured maximum, and
    preserve a final partial report at stop or transport boundary. No overlap:
    retry deduplication uses the report UUID, not guessed transcript similarity.
    """
    def __init__(self, emit, maximum_seconds=20):
        self.emit = emit
        self.maximum_frames = int(maximum_seconds * 50)
        self.minimum_frames = min(600, self.maximum_frames)
        self.frames = []
        self.recent = deque(maxlen=200)
        self.quiet = 0
        self.total_frames = 0

    def feed(self, pcm):
        if len(pcm) != 640: raise ValueError('Expected a decoded 20 ms frame.')
        samples = array.array('h', pcm)
        if sys.byteorder != 'little': samples.byteswap()
        rms = math.sqrt(sum(x*x for x in samples)/len(samples))
        self.frames.append(pcm)
        self.recent.append(rms)
        self.total_frames += 1
        self.quiet = self.quiet + 1 if rms < max(60, max(self.recent)*.2) else 0
        if self.total_frames % 250 == 0:
            log('audio_progress', decodedFrames=self.total_frames, pcmSamples=self.total_frames*320,
                bufferedSeconds=len(self.frames)/50, recentRms=round(rms))
        if len(self.frames) >= self.maximum_frames or (len(self.frames) >= self.minimum_frames and self.quiet >= 40):
            self.flush()

    def flush(self):
        if not self.frames: return
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(self.frames))
        self.emit(buffer.getvalue())
        log('continuous_report_queued', audioSeconds=len(self.frames)/50, wavBytes=buffer.tell())
        self.frames.clear()
        self.quiet = 0

    def reset(self):
        self.flush()
        self.recent.clear()
        self.quiet = 0


def sdk_at(path):
    path = Path(path).resolve()
    if not (path / 'AGENTS.md').is_file() or not (path / 'python/vexo_open/sync.py').is_file():
        raise ValueError('Set VEXO_KIT_PATH to the unmodified official vexo-open-kit directory.')
    sys.path.insert(0, str(path / 'python'))
    sys.path.insert(0, str(path / 'examples/python'))
    from vexo_open.sync import Band
    from vexo_open.audio import PcmDecoder
    return Band, PcmDecoder


def run_capture(args, config):
    number = own_number(config['VEXO_BAND_NUMBER'])
    if not args.confirm_capture:
        raise ValueError('To start the physical microphone, pass --confirm-capture after telling nearby people their sound will be sent to the selected speech provider.')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', args.incident_id) or not 1 <= len(args.speaker.strip()) <= 80:
        raise ValueError('Choose a valid incident ID and a speaker name of 1–80 characters.')
    backend = Backend(config['COPILOT_URL'], config.get('RELAY_ACCESS_TOKEN', ''))
    health = backend.health()
    if args.provider == 'gemini' and not health.get('voice', {}).get('gemini', {}).get('configured'):
        raise ValueError('Backend Gemini speech is not configured. No band was connected.')
    Band, PcmDecoder = sdk_at(config['VEXO_KIT_PATH'])
    if args.provider == 'deepgram':
        import speech
        speech.find_key()  # Validate presence locally; do not print the key.
        decoder = None
    else:
        log('decoder_loading', note='loading the kit decoder before the microphone starts')
        decoder = PcmDecoder(conceal=False)
    identity = {'bandNumber': number, 'incidentId': args.incident_id, 'speaker': args.speaker.strip(), 'provider': args.provider, 'origin': backend.origin}
    digest = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:20]
    outbox = Outbox(Path(args.spool_dir) / digest, identity)
    stop, fatal, delivery_stop, ready = threading.Event(), threading.Event(), threading.Event(), threading.Event()
    capture_ended = threading.Event()
    packets = queue.Queue(maxsize=250)  # Five seconds of packets. Overflow stops capture explicitly.
    band = None
    verified_source = None
    workers = []
    def interrupt(*_):
        stop.set()
        if band is None: raise KeyboardInterrupt
    old_signal = signal.signal(signal.SIGINT, interrupt)
    old_term = signal.signal(signal.SIGTERM, interrupt)
    accepting_finals = threading.Event()
    accepting_finals.set()
    parent_pid = os.environ.get('VEXO_PARENT_PID')
    if parent_pid:
        def watch_parent():
            while not stop.wait(.5):
                if os.getppid() != int(parent_pid):
                    log('controller_closed', action='microphone stopping')
                    stop.set()
        threading.Thread(target=watch_parent, daemon=True).start()

    def enqueue(kind, payload):
        if verified_source is None: raise ValueError('Physical provenance requires a verified band connection.')
        source = dict(verified_source, capturedAt=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'))
        outbox.append(kind, dict(incidentId=identity['incidentId'], speaker=identity['speaker'], provider=args.provider, sourceDevice=source, **payload))

    def emit_audio(wav):
        enqueue('audio', {'audio': base64.b64encode(wav).decode('ascii'),
                          **({'captureMode': 'continuous'} if args.capture_mode == 'continuous' else {})})

    def emit_text(text, final):
        if final and text.strip() and accepting_finals.is_set():
            if len(text.strip()) > 4000:
                fatal.set(); stop.set(); log('transcript_too_long', action='capture stopped; no truncated report sent'); return
            try:
                enqueue('text', {'text': text.strip()})
            except (ValueError, OSError):
                fatal.set(); stop.set(); log('outbox_write_failed', action='capture stopped')

    def offer(item):
        try:
            packets.put_nowait(item)
        except queue.Full:
            fatal.set(); stop.set(); log('packet_buffer_full', action='capture stopped; repeat the unfinished report')

    def consume():
        nonlocal decoder
        ears = None
        segmenter = (BoundedReport(emit_audio, args.seconds, args.diagnostic_dir) if args.capture_mode == 'bounded'
            else ContinuousReports(emit_audio, args.continuous_seconds) if args.capture_mode == 'continuous'
            else Utterances(emit_audio, args.maximum_seconds, args.threshold_ratio))
        previous_seq = None
        pcm_pending = bytearray()
        packet_count = packet_bytes = packet_gaps = 0

        def feed_pcm(pcm):
            pcm_pending.extend(pcm)
            while len(pcm_pending) >= 640:
                segmenter.feed(bytes(pcm_pending[:640]))
                del pcm_pending[:640]

        def reset_stream(resume=True):
            nonlocal ears, decoder, previous_seq
            if args.capture_mode == 'continuous' and decoder:
                feed_pcm(decoder.flush())
                if pcm_pending:
                    segmenter.feed(bytes(pcm_pending).ljust(640, b'\x00'))
            segmenter.reset(); previous_seq = None; pcm_pending.clear()
            if ears:
                accepting_finals.clear()
                try: ears.stop()
                finally: ears = None
            if resume:
                accepting_finals.set()
                if args.provider == 'deepgram':
                    ears = speech.create(endpointing=500).start(emit_text)
                else:
                    decoder = PcmDecoder(conceal=False)
            log('capture_boundary_reset', preserved=args.capture_mode == 'continuous', note='transport boundary; no audio is invented across the gap')

        try:
            if args.provider == 'deepgram':
                ears = speech.create(endpointing=500).start(emit_text)
            ready.set()
            while not capture_ended.is_set() or not packets.empty():
                try:
                    kind, value = packets.get(timeout=.2)
                except queue.Empty:
                    if ears and ears.error: raise ValueError('Speech stream failed.')
                    continue
                if kind in ('suspend', 'resume'):
                    reset_stream(kind == 'resume')
                    continue
                packet, seq = value
                packet_count += 1
                packet_bytes += len(packet)
                if packet_count % 250 == 0:
                    log('audio_totals', packets=packet_count, opusBytes=packet_bytes, packetGaps=packet_gaps)
                if previous_seq is not None and seq != (previous_seq + 1) % 65536:
                    packet_gaps += 1
                    reset_stream()
                    log('audio_packet_gap', action='review any report spanning the connection gap')
                previous_seq = seq
                if ears:
                    ears.feed(packet, seq)
                    if ears.error: raise ValueError('Speech stream failed.')
                elif args.provider == 'gemini':
                    feed_pcm(decoder.feed(packet, seq))
            if not fatal.is_set():
                if decoder:
                    feed_pcm(decoder.flush())
                segmenter.flush()
                log('audio_totals', packets=packet_count, opusBytes=packet_bytes, packetGaps=packet_gaps)
        except Exception:
            fatal.set(); stop.set(); log('audio_processing_failed', action='capture stopped; check kit/decoder or provider configuration; no fallback')
        finally:
            if ears:
                try: ears.stop()
                except Exception: log('speech_stop_failed', action='check finalized turns on the dashboard')

    try:
        log('capture_notice', provider=args.provider, note='The physical microphone records nearby people. Tell them their sound goes to this provider. The solid blue light must stay visible.')
        log('connecting_own_band', bandNumber=number, transport=args.transport)
        band = Band.connect(number, transport=args.transport, auto_reconnect=args.capture_mode != 'bounded', reconnect_seconds=120)
        if band.number != number or band.transport_kind != args.transport:
            raise ValueError('Band identity or transport mismatch. Disconnecting without configuring any stream.')
        verified_source = {'kind':'vexo','bandNumber':number,'transport':args.transport}
        log('own_band_connected', bandNumber=number, transport=band.transport_kind)
        first_audio = threading.Event()
        def on_audio(event):
            if not first_audio.is_set():
                first_audio.set(); log('audio_stream_observed', bandNumber=number, packetBytes=len(event.opus))
            offer(('audio', (bytes(event.opus), event.seq)))
        band.on('audio', on_audio)
        band.on('reconnecting', lambda event: (log('band_reconnecting', note='capture gap; pending turns kept'), offer(('suspend', None))))
        band.on('reconnected', lambda event: (log('band_reconnected', note='SDK restores microphone configuration'), offer(('resume', None))) if band.number == number else (fatal.set(), stop.set()))
        band.on('disconnect', lambda event: (log('band_disconnected', reason=str(event.reason)), stop.set()))
        band.on('stream-taken', lambda event: (log('stream_taken', action='capture stopped; close the other band client before restarting'), fatal.set(), stop.set()))
        workers = [threading.Thread(target=consume, daemon=True), threading.Thread(target=sender, args=(outbox, backend, delivery_stop, fatal, stop), daemon=True)]
        for worker in workers:
            worker.start()
        if not ready.wait(15) or fatal.is_set() or stop.is_set():
            raise ValueError('Speech worker did not initialize; microphone was not started.')
        log('capture_ready', mode=args.capture_mode, note='Speak when the microphone starts. Continuous mode sends rolling reports until Stop; Ctrl+C also stops capture.')
        band.configure(audio=True)
        log('microphone_capture_started', bandNumber=number, boundedSeconds=args.seconds)
        started = time.monotonic()
        while not stop.wait(.1):
            # Reserve one outbox slot for the final partial recording on shutdown.
            if len(outbox.pending()) >= outbox.maximum - 1:
                log('delivery_backlog_full', pending=len(outbox.pending()), action='microphone stopping; queued audio retained, restore delivery before restarting')
                stop.set()
            if args.seconds and time.monotonic() - started >= args.seconds:
                stop.set()
        try:
            if band.connected:
                band.configure(audio=False)
        except Exception:
            log('microphone_stop_pending', note='disconnecting the owned band next')
        band.disconnect()
        band = None
        capture_ended.set()
        workers[0].join(timeout=5)
        log('microphone_off_delivery_pending', pending=len(outbox.pending()))
        until = time.monotonic() + 130
        while outbox.pending() and time.monotonic() < until and workers[1].is_alive():
            time.sleep(.1)
        delivery_stop.set()
        workers[1].join(timeout=125)  # Do not release the outbox lease during an in-flight request.
        log('bridge_stopped', pending=len(outbox.pending()), note='Unacknowledged turns remain on disk with the same IDs. Restart with the same incident/speaker/provider to retry.')
        return 1 if fatal.is_set() else 0
    finally:
        stop.set()
        if band:
            try:
                if band.connected: band.configure(audio=False)
            except Exception: pass
            try: band.disconnect()
            except Exception: log('disconnect_failed', action='check the assigned band and stop its microphone manually if its blue light remains on')
        capture_ended.set()
        delivery_stop.set()
        signal.signal(signal.SIGINT, old_signal)
        signal.signal(signal.SIGTERM, old_term)
        outbox.close()


def drain_saved(args, config):
    """Retry already-authorized saved audio without importing or connecting hardware."""
    backend = Backend(config['COPILOT_URL'], config.get('RELAY_ACCESS_TOKEN', ''))
    identity = {'bandNumber': own_number(config['VEXO_BAND_NUMBER']), 'incidentId': args.incident_id,
                'speaker': args.speaker.strip(), 'provider': args.provider, 'origin': backend.origin}
    digest = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:20]
    outbox = Outbox(Path(args.spool_dir)/digest, identity)
    stop, fatal = threading.Event(), threading.Event()
    old_signal = signal.signal(signal.SIGINT, lambda *_: stop.set())
    old_term = signal.signal(signal.SIGTERM, lambda *_: stop.set())
    worker = threading.Thread(target=sender, args=(outbox,backend,stop,fatal), daemon=True)
    try:
        log('microphone_off_delivery_pending', pending=len(outbox.pending()))
        worker.start()
        until = time.monotonic()+130
        while outbox.pending() and worker.is_alive() and not stop.is_set() and time.monotonic()<until:
            stop.wait(.1)
        stop.set(); worker.join(timeout=125)
        log('bridge_stopped', pending=len(outbox.pending()))
        return 1 if fatal.is_set() else 0
    finally:
        stop.set()
        signal.signal(signal.SIGINT, old_signal); signal.signal(signal.SIGTERM, old_term)
        outbox.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Import kit and inspect prerequisites; never construct or connect a band.')
    parser.add_argument('--connect-check', action='store_true', help='Connect to the assigned own band then disconnect; never configure its microphone.')
    parser.add_argument('--drain-only', action='store_true', help='Retry saved reports only; never import/connect a band or start a microphone.')
    parser.add_argument('--incident-id', default='apartment-demo')
    parser.add_argument('--speaker', default='Firefighter A')
    parser.add_argument('--provider', choices=['gemini', 'deepgram'], default='gemini')
    parser.add_argument('--transport', choices=['ble', 'serial'], default='ble')
    parser.add_argument('--confirm-capture', action='store_true')
    parser.add_argument('--maximum-seconds', type=float, default=8)
    parser.add_argument('--threshold-ratio', type=float, default=3)
    parser.add_argument('--seconds', type=float, default=0, help='Stop after this many seconds; 0 means until Ctrl+C.')
    parser.add_argument('--spool-dir', default='data/vexo-live')
    parser.add_argument('--capture-mode', choices=['bounded', 'continuous', 'vad'], default='bounded')
    parser.add_argument('--continuous-seconds', type=float, default=20, help='Maximum continuous report size, 12–60 seconds; capture itself runs until stopped.')
    parser.add_argument('--diagnostic-dir', help='Save this bounded report and non-secret audio metrics locally.')
    args = parser.parse_args()
    try:
        if not 2 <= args.maximum_seconds <= 15 or not 1.5 <= args.threshold_ratio <= 10 or not 0 <= args.seconds <= 3600:
            raise ValueError('Maximum clip: 2–15 seconds; threshold ratio: 1.5–10; duration: 0–3600 seconds.')
        config = settings()
        if args.drain_only:
            return drain_saved(args, config)
        if not 12 <= args.continuous_seconds <= 60:
            raise ValueError('Continuous report size must be 12–60 seconds.')
        if args.capture_mode == 'continuous' and args.provider != 'gemini':
            raise ValueError('Continuous PCM reports currently use Gemini.')
        if not args.check and not args.connect_check and args.capture_mode == 'bounded' and (args.provider != 'gemini' or not 1 <= args.seconds <= 120):
            raise ValueError('Bounded reports require Gemini and an explicit duration of 1–120 seconds. Use --capture-mode vad for legacy continuous capture.')
        backend_url(config['COPILOT_URL'], config.get('RELAY_ACCESS_TOKEN', ''))
        if args.check:
            sdk_at(config['VEXO_KIT_PATH'])
            log('sdk_import_ok', bandNumberConfigured=bool(config['VEXO_BAND_NUMBER']), decoderAvailable=importlib.util.find_spec('av') is not None,
                bluetoothAvailable=importlib.util.find_spec('bleak') is not None, note='No band constructed or connected; physical capture not validated.')
            return 0
        if args.connect_check:
            number = own_number(config['VEXO_BAND_NUMBER'])
            Band, _ = sdk_at(config['VEXO_KIT_PATH'])
            band = Band.connect(number, transport=args.transport)
            try:
                if band.number != number: raise ValueError('Wrong band identity; disconnecting without configuring a stream.')
                log('own_band_connection_verified', bandNumber=number, transport=args.transport, microphoneEnabled=False)
            finally: band.disconnect()
            return 0
        return run_capture(args, config)
    except KeyboardInterrupt:
        log('bridge_cancelled', note='No alternate band was tried.'); return 0
    except Exception as error:
        # SDK errors may include external data; only our own validation text is displayed.
        code = getattr(error, 'code', 'configuration-or-transport')
        message = str(error) if isinstance(error, ValueError) else ('Own band not visible. Close its other client, double-tap the assigned band so it blinks blue, then retry. No alternate band was tried.' if code == 'not-found-nearby' else 'Check local backend, kit installation, assigned band number and Python transport dependencies. No alternate band was tried.')
        log('bridge_start_failed', code=code, message=message)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
