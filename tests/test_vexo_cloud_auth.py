"""Remote bridge transport checks; no SDK, device, microphone or network calls."""
import base64
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
import urllib.parse
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bridge_cloud_auth', Path(__file__).resolve().parents[1] / 'scripts/vexo-live.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class CloudAuthTests(unittest.TestCase):
    def test_remote_requires_https_origin_and_token(self):
        token = 'test-only-' * 4
        for value in ['http://remote.example', 'https://remote.example/path', 'https://u:p@remote.example', 'https://remote.example?x=1', 'https://remote.example#x']:
            with self.assertRaises(ValueError): bridge.backend_url(value, token)
        with self.assertRaises(ValueError): bridge.backend_url('https://remote.example', '')
        self.assertEqual(bridge.backend_url('https://remote.example/', token), 'https://remote.example')
        self.assertEqual(bridge.backend_url('http://127.0.0.1:3001/'), 'http://127.0.0.1:3001')
        self.assertIsNone(bridge.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.example'))

    def test_auth_for_health_text_and_continuous_audio_preserves_capture_mode(self):
        token = 'test-only-' * 4
        backend = bridge.Backend('https://remote.example', token)
        requests = []
        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                return io.BytesIO(b'{"kind":"queued","jobId":"fixture"}')
        backend.opener = Opener()
        backend.health()
        record = dict(incidentId='fixture', speaker='Demo', clientEventId='fixture-event',
                      sourceDevice=dict(bandNumber=38, transport='ble', capturedAt='2026-11-14T21:00:00Z'))
        backend.send(dict(record, kind='text', text='Fictional report'))
        payload = b'fixture-not-recorded-audio'
        result = backend.send(dict(record, kind='audio', audio=base64.b64encode(payload).decode(), provider='gemini', captureMode='continuous'))
        self.assertEqual(result['kind'], 'queued')
        self.assertEqual(len(requests), 3)
        for req in requests:
            self.assertEqual(req.get_header('Authorization'), 'Bearer ' + token)
            self.assertNotIn(token, req.full_url)
        self.assertEqual(requests[-1].data, payload)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(requests[-1].full_url).query)
        self.assertEqual(query['captureMode'], ['continuous'])
        self.assertEqual(query['bandNumber'], ['38'])
        self.assertEqual(query['consent'], ['send-to-gemini'])

    def test_environment_overrides_private_env_file(self):
        cwd = Path.cwd()
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            try:
                os.chdir(folder)
                Path('.env').write_text('RELAY_ACCESS_TOKEN=file-fixture\nCOPILOT_URL=https://fixture.example\n')
                self.assertEqual(bridge.settings()['RELAY_ACCESS_TOKEN'], 'file-fixture')
                os.environ['RELAY_ACCESS_TOKEN'] = 'environment-fixture'
                self.assertEqual(bridge.settings()['RELAY_ACCESS_TOKEN'], 'environment-fixture')
                os.environ['RELAY_ACCESS_TOKEN'] = ''
                self.assertEqual(bridge.settings()['RELAY_ACCESS_TOKEN'], '')
            finally:
                os.chdir(cwd)
