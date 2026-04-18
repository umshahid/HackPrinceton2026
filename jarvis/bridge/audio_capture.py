"""Capture the glasses microphone audio from the WhatsApp call via WASAPI loopback."""

import asyncio
import queue
import numpy as np
from loguru import logger

from jarvis.config import AUDIO_SAMPLE_RATE, AUDIO_CHANNELS

# Try pyaudiowpatch first (Windows WASAPI loopback), fall back to sounddevice
_audio_backend = None
try:
    import pyaudiowpatch as pyaudio
    _audio_backend = "pyaudiowpatch"
except ImportError:
    try:
        import sounddevice as sd
        _audio_backend = "sounddevice"
    except ImportError:
        pass


class AudioCapturer:
    """Captures audio from WhatsApp call (glasses mic audio arriving via WASAPI loopback)."""

    def __init__(self, device_name: str | None = None):
        self._running = False
        self._audio_queue: queue.Queue[bytes] = queue.Queue(maxsize=200)
        self._device_name = device_name
        self._stream = None
        self._pyaudio_instance = None

    def list_audio_devices(self) -> list[dict]:
        """List available audio devices for capture."""
        devices = []
        if _audio_backend == "pyaudiowpatch":
            p = pyaudio.PyAudio()
            for i in range(p.get_device_count()):
                dev = p.get_device_info_by_index(i)
                devices.append({
                    "index": i,
                    "name": dev["name"],
                    "channels": dev["maxInputChannels"],
                    "is_loopback": dev.get("isLoopbackDevice", False),
                })
            p.terminate()
        elif _audio_backend == "sounddevice":
            for i, dev in enumerate(sd.query_devices()):
                devices.append({
                    "index": i,
                    "name": dev["name"],
                    "channels": dev["max_input_channels"],
                    "is_loopback": False,
                })
        return devices

    def find_loopback_device(self) -> int | None:
        """Find a WASAPI loopback device (captures system audio output)."""
        if _audio_backend != "pyaudiowpatch":
            logger.warning("WASAPI loopback requires pyaudiowpatch on Windows")
            return None

        p = pyaudio.PyAudio()
        try:
            wasapi_info = p.get_host_api_info_by_type(pyaudio.paWASAPI)
        except OSError:
            logger.error("WASAPI not available")
            p.terminate()
            return None

        default_speakers = p.get_device_info_by_index(wasapi_info["defaultOutputDevice"])
        logger.info(f"Default speakers: {default_speakers['name']}")

        # Find the loopback version of default speakers
        for i in range(p.get_device_count()):
            dev = p.get_device_info_by_index(i)
            if dev.get("isLoopbackDevice") and dev["name"].startswith(default_speakers["name"][:30]):
                logger.info(f"Found loopback device: {dev['name']} (index {i})")
                p.terminate()
                return i

        p.terminate()
        return None

    def _audio_callback(self, in_data, frame_count, time_info, status):
        """PyAudio callback — puts raw audio into the queue, resampled to 16kHz mono."""
        if status:
            logger.debug(f"Audio status: {status}")
        try:
            audio = np.frombuffer(in_data, dtype=np.int16)

            # Convert stereo to mono if needed
            if getattr(self, '_native_channels', 1) > 1:
                audio = audio.reshape(-1, self._native_channels)
                audio = audio.mean(axis=1).astype(np.int16)

            # Resample to 16kHz if needed
            native_rate = getattr(self, '_native_rate', AUDIO_SAMPLE_RATE)
            if native_rate != AUDIO_SAMPLE_RATE:
                num_samples = int(len(audio) * AUDIO_SAMPLE_RATE / native_rate)
                indices = np.linspace(0, len(audio) - 1, num_samples).astype(int)
                audio = audio[indices]

            self._audio_queue.put_nowait(audio.tobytes())
        except queue.Full:
            pass  # Drop frames if consumer is too slow
        return (None, pyaudio.paContinue)

    def start(self):
        """Start capturing audio."""
        if _audio_backend == "pyaudiowpatch":
            self._start_pyaudio()
        elif _audio_backend == "sounddevice":
            self._start_sounddevice()
        else:
            logger.error("No audio backend available. Install pyaudiowpatch or sounddevice.")
            return
        self._running = True
        logger.info("Audio capture started")

    def _start_pyaudio(self):
        """Start capture using pyaudiowpatch (WASAPI loopback)."""
        self._pyaudio_instance = pyaudio.PyAudio()

        device_index = self.find_loopback_device()
        if device_index is None:
            logger.warning("No loopback device found, using default input")
            device_index = None

        # Use device's native sample rate for WASAPI loopback (usually 48kHz)
        rate = AUDIO_SAMPLE_RATE
        channels = AUDIO_CHANNELS
        if device_index is not None:
            dev_info = self._pyaudio_instance.get_device_info_by_index(device_index)
            rate = int(dev_info.get("defaultSampleRate", AUDIO_SAMPLE_RATE))
            channels = max(1, min(dev_info.get("maxInputChannels", AUDIO_CHANNELS), 2))
            logger.info(f"Loopback device native rate: {rate}Hz, channels: {channels}")
        self._native_rate = rate
        self._native_channels = channels

        kwargs = {
            "format": pyaudio.paInt16,
            "channels": channels,
            "rate": rate,
            "input": True,
            "frames_per_buffer": int(rate * 0.03),  # 30ms chunks
            "stream_callback": self._audio_callback,
        }
        if device_index is not None:
            kwargs["input_device_index"] = device_index

        self._stream = self._pyaudio_instance.open(**kwargs)
        self._stream.start_stream()

    def _start_sounddevice(self):
        """Start capture using sounddevice."""
        def callback(indata, frames, time_info, status):
            if status:
                logger.debug(f"Audio status: {status}")
            try:
                self._audio_queue.put_nowait(indata.copy().tobytes())
            except queue.Full:
                pass

        self._stream = sd.InputStream(
            samplerate=AUDIO_SAMPLE_RATE,
            channels=AUDIO_CHANNELS,
            dtype="int16",
            blocksize=int(AUDIO_SAMPLE_RATE * 0.03),
            callback=callback,
        )
        self._stream.start()

    def read_chunk(self, timeout: float = 0.1) -> bytes | None:
        """Read the next audio chunk (blocking with timeout)."""
        try:
            return self._audio_queue.get(timeout=timeout)
        except queue.Empty:
            return None

    async def read_chunk_async(self, timeout: float = 0.1) -> bytes | None:
        """Read the next audio chunk asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.read_chunk, timeout)

    def get_all_chunks(self) -> list[bytes]:
        """Drain all available chunks from the queue."""
        chunks = []
        while not self._audio_queue.empty():
            try:
                chunks.append(self._audio_queue.get_nowait())
            except queue.Empty:
                break
        return chunks

    def stop(self):
        """Stop audio capture."""
        self._running = False
        if self._stream:
            self._stream.stop_stream() if _audio_backend == "pyaudiowpatch" else self._stream.stop()
            self._stream.close() if _audio_backend == "pyaudiowpatch" else self._stream.close()
            self._stream = None
        if self._pyaudio_instance:
            self._pyaudio_instance.terminate()
            self._pyaudio_instance = None
        logger.info("Audio capture stopped")
