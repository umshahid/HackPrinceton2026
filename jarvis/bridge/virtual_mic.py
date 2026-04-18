"""Send AI speech audio to WhatsApp via a virtual microphone (VB-Audio Cable)."""

import asyncio
import queue
import numpy as np
from loguru import logger

from jarvis.config import AUDIO_SAMPLE_RATE, AUDIO_CHANNELS

try:
    import sounddevice as sd
except ImportError:
    sd = None


class VirtualMic:
    """Outputs AI-generated speech to a virtual audio device that WhatsApp uses as mic input.

    Requires VB-Audio Virtual Cable (or similar) installed.
    WhatsApp must be configured to use the virtual cable as its microphone.
    We output audio to the virtual cable's input side.
    """

    def __init__(self, device_name: str | None = None):
        self._device_name = device_name or "CABLE Input"
        self._device_index: int | None = None
        self._audio_queue: queue.Queue[np.ndarray] = queue.Queue(maxsize=500)
        self._stream = None
        self._running = False

    def find_virtual_cable_device(self) -> int | None:
        """Find the VB-Audio Virtual Cable input device."""
        if sd is None:
            logger.error("sounddevice not installed")
            return None

        devices = sd.query_devices()
        for i, dev in enumerate(devices):
            if dev["max_output_channels"] > 0 and self._device_name.lower() in dev["name"].lower():
                logger.info(f"Found virtual cable: {dev['name']} (index {i})")
                return i

        logger.warning(
            f"Virtual cable device '{self._device_name}' not found. "
            "Available output devices:"
        )
        for i, dev in enumerate(devices):
            if dev["max_output_channels"] > 0:
                logger.warning(f"  [{i}] {dev['name']}")
        return None

    def start(self) -> bool:
        """Start the virtual mic output stream."""
        if sd is None:
            logger.error("sounddevice not installed")
            return False

        self._device_index = self.find_virtual_cable_device()
        if self._device_index is None:
            logger.error(
                "Could not find virtual audio cable. "
                "Install VB-Audio Virtual Cable: https://vb-audio.com/Cable/"
            )
            return False

        def callback(outdata, frames, time_info, status):
            if status:
                logger.debug(f"Virtual mic status: {status}")
            try:
                data = self._audio_queue.get_nowait()
                # Ensure correct shape
                if len(data) < frames:
                    padded = np.zeros(frames, dtype=np.int16)
                    padded[:len(data)] = data
                    data = padded
                elif len(data) > frames:
                    data = data[:frames]
                outdata[:, 0] = data.astype(np.float32) / 32768.0
            except queue.Empty:
                outdata.fill(0)  # Silence when no audio queued

        self._stream = sd.OutputStream(
            samplerate=AUDIO_SAMPLE_RATE,
            channels=AUDIO_CHANNELS,
            dtype="float32",
            blocksize=int(AUDIO_SAMPLE_RATE * 0.02),  # 20ms blocks
            device=self._device_index,
            callback=callback,
        )
        self._stream.start()
        self._running = True
        logger.info("Virtual mic started")
        return True

    def write_audio(self, audio_data: bytes | np.ndarray):
        """Queue audio data for output.

        Args:
            audio_data: PCM int16 audio data (bytes or numpy array).
        """
        if isinstance(audio_data, bytes):
            audio_data = np.frombuffer(audio_data, dtype=np.int16)

        # Split into chunks matching the stream blocksize
        chunk_size = int(AUDIO_SAMPLE_RATE * 0.02)
        for i in range(0, len(audio_data), chunk_size):
            chunk = audio_data[i:i + chunk_size]
            try:
                self._audio_queue.put_nowait(chunk)
            except queue.Full:
                logger.debug("Virtual mic queue full, dropping audio chunk")
                break

    async def write_audio_async(self, audio_data: bytes | np.ndarray):
        """Queue audio data asynchronously."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self.write_audio, audio_data)

    def stop(self):
        """Stop the virtual mic output."""
        self._running = False
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        logger.info("Virtual mic stopped")
