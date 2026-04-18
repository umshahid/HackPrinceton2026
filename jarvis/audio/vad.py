"""Voice Activity Detection — detect when the user is speaking."""

import numpy as np
from loguru import logger

from jarvis.config import AUDIO_SAMPLE_RATE, AUDIO_CHUNK_MS

try:
    import webrtcvad
except ImportError:
    webrtcvad = None


class VoiceActivityDetector:
    """Detects voice activity in audio chunks.

    Uses WebRTC VAD for lightweight, low-latency detection.
    Supports aggressiveness levels 0-3 (0 = least aggressive, 3 = most aggressive
    at filtering out non-speech).
    """

    def __init__(self, aggressiveness: int = 2, speech_threshold: float = 0.6):
        """
        Args:
            aggressiveness: WebRTC VAD aggressiveness (0-3). Higher = more aggressive filtering.
            speech_threshold: Fraction of recent frames that must be speech to trigger.
        """
        self._vad = None
        self._aggressiveness = aggressiveness
        self._speech_threshold = speech_threshold
        self._ring_buffer: list[bool] = []
        self._ring_buffer_size = 15  # ~450ms of history at 30ms chunks
        self._is_speaking = False

        if webrtcvad is not None:
            self._vad = webrtcvad.Vad(aggressiveness)
            logger.info(f"WebRTC VAD initialized (aggressiveness={aggressiveness})")
        else:
            logger.warning("webrtcvad not installed, using energy-based fallback")

    def is_speech(self, audio_chunk: bytes, sample_rate: int = None) -> bool:
        """Check if an audio chunk contains speech.

        Args:
            audio_chunk: Raw PCM int16 audio bytes. Must be 10, 20, or 30ms for WebRTC VAD.
            sample_rate: Sample rate (default: from config).
        """
        sample_rate = sample_rate or AUDIO_SAMPLE_RATE

        if self._vad is not None:
            # WebRTC VAD needs exactly 10, 20, or 30ms of audio
            expected_bytes = 2 * sample_rate * AUDIO_CHUNK_MS // 1000
            if len(audio_chunk) != expected_bytes:
                # Pad or trim to expected size
                if len(audio_chunk) < expected_bytes:
                    audio_chunk = audio_chunk + b'\x00' * (expected_bytes - len(audio_chunk))
                else:
                    audio_chunk = audio_chunk[:expected_bytes]

            try:
                return self._vad.is_speech(audio_chunk, sample_rate)
            except Exception:
                return self._energy_based_vad(audio_chunk)
        else:
            return self._energy_based_vad(audio_chunk)

    def _energy_based_vad(self, audio_chunk: bytes, threshold: int = 500) -> bool:
        """Simple energy-based VAD fallback."""
        audio = np.frombuffer(audio_chunk, dtype=np.int16)
        energy = np.sqrt(np.mean(audio.astype(np.float32) ** 2))
        return energy > threshold

    def process_chunk(self, audio_chunk: bytes) -> bool:
        """Process a chunk and return whether user is currently speaking.

        Uses a ring buffer to smooth out detection and avoid rapid toggling.
        """
        speech = self.is_speech(audio_chunk)

        self._ring_buffer.append(speech)
        if len(self._ring_buffer) > self._ring_buffer_size:
            self._ring_buffer.pop(0)

        speech_ratio = sum(self._ring_buffer) / len(self._ring_buffer)

        was_speaking = self._is_speaking
        if not self._is_speaking and speech_ratio > self._speech_threshold:
            self._is_speaking = True
            logger.debug("Speech started")
        elif self._is_speaking and speech_ratio < (self._speech_threshold * 0.5):
            self._is_speaking = False
            logger.debug("Speech ended")

        return self._is_speaking

    @property
    def speaking(self) -> bool:
        """Whether the user is currently speaking."""
        return self._is_speaking

    def reset(self):
        """Reset the VAD state."""
        self._ring_buffer.clear()
        self._is_speaking = False
