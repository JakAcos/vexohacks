import array
import importlib.util
import io
import math
import tempfile
import unittest
import wave
from pathlib import Path

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).resolve().parents[1] / 'scripts/vexo-live.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BoundedCaptureTests(unittest.TestCase):
    def test_high_background_does_not_erase_report(self):
        sent = []
        capture = bridge.BoundedReport(sent.append, 2)
        frame = array.array('h', [int(2073 * math.sin(2 * math.pi * i / 32)) for i in range(320)]).tobytes()
        for _ in range(100):
            capture.feed(frame)
        capture.flush()
        self.assertEqual(capture.old_clips, 0)
        self.assertEqual(len(sent), 1)
        with wave.open(io.BytesIO(sent[0])) as wav:
            self.assertEqual(wav.readframes(32000), frame * 100)

    def test_boundary_keeps_received_audio_and_writes_private_artifact(self):
        sent = []
        with tempfile.TemporaryDirectory() as directory:
            capture = bridge.BoundedReport(sent.append, 2, directory)
            capture.feed(bytes(640))
            capture.reset()
            capture.feed(bytes(640))
            capture.flush()
            saved = Path(directory) / 'capture.wav'
            self.assertEqual(saved.read_bytes(), sent[0])
            self.assertEqual(saved.stat().st_mode & 0o777, 0o600)
            with wave.open(str(saved)) as wav:
                self.assertEqual(wav.getnframes(), 640)

    def test_empty_capture_never_posts_and_duration_is_bounded(self):
        sent = []
        capture = bridge.BoundedReport(sent.append, 1)
        capture.flush()
        self.assertEqual(sent, [])
        for _ in range(100):
            capture.feed(bytes(640))
        with self.assertRaises(ValueError):
            capture.feed(bytes(640))


if __name__ == '__main__':
    unittest.main()
