"""Bridge-only checks; never construct/connect a real or simulated band."""
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/vexo-live.py'
spec = importlib.util.spec_from_file_location('vexo_live_bridge', SCRIPT)
bridge = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bridge
spec.loader.exec_module(bridge)


class FastEvent(threading.Event):
    def wait(self, seconds=None):
        return super().wait(min(seconds or .01, .01))


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.silence = struct.pack('<320h', *([20] * 320))
        self.speech = struct.pack('<320h', *([500, -500] * 160))

    def test_local_backend_only_and_no_redirect(self):
        for value in ['https://localhost', 'http://other.example', 'http://localhost/path', 'http://user:password@localhost', 'http://localhost?target=x']:
            with self.assertRaises(ValueError): bridge.local_url(value)
        self.assertEqual(bridge.local_url('http://127.0.0.1:3001/'), 'http://127.0.0.1:3001')
        self.assertIsNone(bridge.NoRedirect().redirect_request(None, None, 302, '', {}, 'http://unrelated.example'))

    def test_missing_number_never_reaches_sdk_connection(self):
        env = dict(os.environ, VEXO_BAND_NUMBER='', PYTHONDONTWRITEBYTECODE='1')
        process = subprocess.run([sys.executable, str(SCRIPT), '--connect-check'], cwd=SCRIPT.parents[1], env=env, capture_output=True, text=True, timeout=10)
        self.assertEqual(process.returncode, 1)
        self.assertIn('No default or guessed band number', process.stdout)
        self.assertNotIn('own_band_connection_verified', process.stdout)

    def test_calibration_segmentation_and_wav_parameters(self):
        emitted = []
        segmenter = bridge.Utterances(emitted.append)
        with patch.object(bridge, 'log'):
            for _ in range(50): segmenter.feed(self.silence)
            for _ in range(15): segmenter.feed(self.silence)
            for _ in range(20): segmenter.feed(self.speech)
            self.assertFalse(emitted)
            for _ in range(40): segmenter.feed(self.silence)
        self.assertEqual(len(emitted), 1)
        with wave.open(io.BytesIO(emitted[0])) as wav:
            self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()), (1, 2, 16000))
            self.assertEqual(wav.getnframes(), 75 * 320)

    def test_reset_drops_unfinished_audio_and_long_speech_has_bounded_chunks(self):
        emitted = []; segmenter = bridge.Utterances(emitted.append, maximum_seconds=2)
        with patch.object(bridge, 'log'):
            for _ in range(50): segmenter.feed(self.silence)
            for _ in range(20): segmenter.feed(self.speech)
            segmenter.reset(); segmenter.flush()
            self.assertFalse(emitted)
            for _ in range(50): segmenter.feed(self.silence)
            for _ in range(200): segmenter.feed(self.speech)
        self.assertEqual(len(emitted), 2)
        for payload in emitted:
            with wave.open(io.BytesIO(payload)) as wav: self.assertLessEqual(wav.getnframes(), 32000)

    def test_durable_identity_fifo_permissions_and_capacity(self):
        identity = {'fixture': 'owned-source'}
        with tempfile.TemporaryDirectory() as folder, patch.object(bridge, 'log'):
            outbox = bridge.Outbox(folder, identity, maximum=2)
            first = outbox.append('text', {'incidentId': 'fixture', 'speaker': 'A', 'text': 'A report'})
            second = outbox.append('text', {'incidentId': 'fixture', 'speaker': 'A', 'text': 'Another report'})
            self.assertNotEqual(first, second); uuid.UUID(first)
            self.assertEqual(outbox.read(outbox.pending()[0])['clientEventId'], first)
            self.assertEqual(outbox.pending()[0].stat().st_mode & 0o077, 0)
            with self.assertRaises(ValueError): outbox.append('text', {})
            with self.assertRaises(ValueError): bridge.Outbox(folder, identity)
            outbox.close()
            with self.assertRaises(ValueError): bridge.Outbox(folder, {'fixture': 'other-source'})
            outbox = bridge.Outbox(folder, identity)
            self.assertEqual(outbox.read(outbox.pending()[1])['clientEventId'], second)
            outbox.acknowledge(outbox.pending()[0]); self.assertEqual(len(outbox.pending()), 1)
            outbox.close()

    def test_retry_reuses_uuid_and_preserves_order_until_acknowledged(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(bridge, 'log'):
            outbox = bridge.Outbox(folder, {'fixture': 'retry'})
            event_id = outbox.append('text', {'incidentId': 'fixture', 'speaker': 'A', 'text': 'Report'})
            stop = FastEvent(); fatal = threading.Event(); calls = []
            class Backend:
                def send(self, record):
                    calls.append(record['clientEventId'])
                    if len(calls) == 1: raise urllib.error.URLError('offline')
                    stop.set(); return {'kind': 'observation'}
            bridge.sender(outbox, Backend(), stop, fatal)
            self.assertEqual(calls, [event_id, event_id]); self.assertFalse(fatal.is_set()); self.assertFalse(outbox.pending()); outbox.close()

    def test_rejected_turn_stops_capture_and_retains_same_record(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(bridge, 'log'):
            outbox = bridge.Outbox(folder, {'fixture': 'rejected'})
            event_id = outbox.append('text', {'incidentId': 'fixture', 'speaker': 'A', 'text': 'Report'})
            stop, fatal, capture = threading.Event(), threading.Event(), threading.Event()
            class Backend:
                def send(self, record): raise urllib.error.HTTPError('local', 422, 'rejected', {}, None)
            bridge.sender(outbox, Backend(), stop, fatal, capture)
            self.assertTrue(fatal.is_set()); self.assertTrue(capture.is_set()); self.assertEqual(outbox.read(outbox.pending()[0])['clientEventId'], event_id); outbox.close()

    def test_real_local_http_contract_has_source_uuid_and_matching_consent(self):
        seen = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                seen.append((self.path, self.headers.get('Content-Type'), self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(b'{"kind":"observation","incident":{}}')
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
        try:
            client = bridge.Backend('http://127.0.0.1:%d' % server.server_port)
            event_id = str(uuid.uuid4())
            source = {'kind':'vexo','bandNumber':38,'transport':'ble','capturedAt':'2026-11-14T20:00:00Z'}  # Known assigned number; mock HTTP only, no connection.
            client.send({'sourceDevice':source,'kind':'text','incidentId':'fixture','speaker':'Firefighter A','text':'Observed smoke','clientEventId':event_id})
            body = json.loads(seen[0][2]); self.assertEqual(body['inputKind'], 'vexo-transcript'); self.assertEqual(body['sourceDevice'],source); self.assertEqual(body['clientEventId'], event_id); self.assertEqual(body['speaker'], 'Firefighter A'); self.assertEqual(seen[0][0], '/api/voice/turn')
            client.send({'sourceDevice':source,'kind':'audio','incidentId':'fixture','speaker':'Firefighter B','provider':'gemini','clientEventId':event_id,'audio':'UklGRg=='})
            self.assertIn('consent=send-to-gemini', seen[1][0]); self.assertIn('inputKind=vexo-audio',seen[1][0]); self.assertIn('bandNumber=38',seen[1][0]); self.assertIn('deviceTransport=ble',seen[1][0]); self.assertIn('clientEventId='+event_id, seen[1][0]); self.assertEqual(seen[1][1], 'audio/wav'); self.assertEqual(seen[1][2], b'RIFF')
        finally:
            server.shutdown(); server.server_close(); worker.join(timeout=2)

    def test_actual_kit_decoder_without_any_band_connection(self):
        path = os.environ.get('VEXO_KIT_PATH')
        if not path: self.skipTest('Set VEXO_KIT_PATH for the actual SDK decoder check; no connection is made.')
        Band, Decoder = bridge.sdk_at(path)
        from vexo_open.audio import ogg_packets
        packets = ogg_packets(Path(path)/'dashboard/speech/sample-speech.opus')
        with patch.object(Band, 'connect', side_effect=AssertionError('No test may connect a band')):
            decoder = Decoder(conceal=False)
            pcm = b''.join(decoder.feed(packet, n) for n, packet in enumerate(packets[:50]))
            self.assertGreater(len(pcm), 0)
            self.assertEqual(len(pcm) % 2, 0)


if __name__ == '__main__':
    unittest.main()
