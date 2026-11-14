import importlib.util
import io
from pathlib import Path
import struct
import tempfile
import threading
from types import SimpleNamespace
import unittest
import wave
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('bridge',Path(__file__).resolve().parents[1]/'scripts/vexo-live.py')
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)

class ContinuousBandTests(unittest.TestCase):
    def test_saved_retry_never_loads_hardware(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(bridge,'log'), patch.object(bridge,'sdk_at',side_effect=AssertionError('No SDK import during drain')):
            args=SimpleNamespace(incident_id='fixture',speaker='Speaker',provider='gemini',spool_dir=folder)
            config={'VEXO_BAND_NUMBER':'38','COPILOT_URL':'http://127.0.0.1:3001'}
            self.assertEqual(bridge.drain_saved(args,config),0)

    def test_twenty_minutes_preserves_every_sample_with_bounded_buffer(self):
        frames=0;clips=0
        frame=struct.pack('<320h',*([1400,-1400]*160))
        def received(payload):
            nonlocal frames,clips
            with wave.open(io.BytesIO(payload)) as wav:
                samples=wav.getnframes();self.assertLessEqual(samples,20*16000)
                self.assertEqual(wav.readframes(samples),frame*(samples//320))
                frames+=samples//320;clips+=1
        segmenter=bridge.ContinuousReports(received,20)
        with patch.object(bridge,'log'):
            for _ in range(20*60*50+17):
                segmenter.feed(frame)
                self.assertLess(len(segmenter.frames),1000)
            segmenter.flush();segmenter.flush()
        self.assertEqual(frames,60017);self.assertEqual(clips,61)

    def test_silence_and_gap_preserve_received_audio_and_final_tail(self):
        output=[];segmenter=bridge.ContinuousReports(output.append,20)
        a=struct.pack('<320h',*([10]*320));b=struct.pack('<320h',*([700]*320))
        with patch.object(bridge,'log'):
            for _ in range(100):segmenter.feed(a)
            segmenter.reset()
            for _ in range(51):segmenter.feed(b)
            segmenter.flush()
        decoded=[]
        for payload in output:
            with wave.open(io.BytesIO(payload)) as wav:decoded.append(wav.readframes(wav.getnframes()))
        self.assertEqual(decoded,[a*100,b*51])

    def test_silence_and_durable_queued_ack_do_not_stop_listening(self):
        for kind in ['silence','queued']:
            with tempfile.TemporaryDirectory() as folder, patch.object(bridge,'log'):
                outbox=bridge.Outbox(folder,{'fixture':kind})
                outbox.append('audio',{'audio':'fixture'})
                stop=threading.Event();fatal=threading.Event();capture=threading.Event()
                class Backend:
                    def send(self,record):stop.set();return {'kind':kind}
                bridge.sender(outbox,Backend(),stop,fatal,capture)
                self.assertFalse(fatal.is_set());self.assertFalse(capture.is_set());self.assertFalse(outbox.pending())
                outbox.close()

    def test_unknown_ack_retains_record_and_stops_capture(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(bridge,'log'):
            outbox=bridge.Outbox(folder,{'fixture':'invalid'})
            outbox.append('audio',{'audio':'fixture'})
            stop=threading.Event();fatal=threading.Event();capture=threading.Event()
            class Backend:
                def send(self,record):return {'ok':True}
            bridge.sender(outbox,Backend(),stop,fatal,capture)
            self.assertTrue(capture.is_set());self.assertEqual(len(outbox.pending()),1)
            outbox.close()

if __name__=='__main__':unittest.main()
