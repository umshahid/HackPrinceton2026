"""Text-to-Speech — fallback TTS when not using Gemini Live's native audio."""

import asyncio
import io
import numpy as np
from loguru import logger

from jarvis.config import AUDIO_SAMPLE_RATE

try:
    import edge_tts
except ImportError:
    edge_tts = None


class TextToSpeech:
    """Converts text to speech audio using edge-tts (Microsoft Edge neural voices).

    This is a fallback for when the AI engine doesn't provide native audio output
    (e.g., when using Claude for a complex task).
    """

    def __init__(self, voice: str = "en-US-GuyNeural"):
        """
        Args:
            voice: Edge TTS voice name. Good options:
                - en-US-GuyNeural (male, clear)
                - en-US-ChristopherNeural (male, deeper)
                - en-GB-RyanNeural (male, British)
        """
        self.voice = voice
        if edge_tts is None:
            logger.warning("edge-tts not installed. TTS will not work.")

    async def synthesize(self, text: str) -> bytes | None:
        """Convert text to PCM int16 audio bytes.

        Returns raw PCM audio at 16kHz mono, or None on failure.
        """
        if edge_tts is None:
            return None

        try:
            communicate = edge_tts.Communicate(text, self.voice)
            audio_data = bytearray()

            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_data.extend(chunk["data"])

            if not audio_data:
                return None

            # edge-tts outputs MP3, we need to convert to PCM
            pcm_audio = await self._mp3_to_pcm(bytes(audio_data))
            return pcm_audio

        except Exception as e:
            logger.error(f"TTS synthesis failed: {e}")
            return None

    async def _mp3_to_pcm(self, mp3_data: bytes) -> bytes | None:
        """Convert MP3 bytes to PCM int16 at target sample rate."""
        try:
            import subprocess
            # Use ffmpeg to convert MP3 → raw PCM
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-i", "pipe:0",
                "-f", "s16le",
                "-ar", str(AUDIO_SAMPLE_RATE),
                "-ac", "1",
                "pipe:1",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate(input=mp3_data)
            if proc.returncode == 0:
                return stdout
            else:
                logger.error(f"ffmpeg conversion failed: {stderr.decode()}")
                return None
        except FileNotFoundError:
            logger.error(
                "ffmpeg not found. Install ffmpeg for TTS audio conversion. "
                "Or use Gemini Live which provides native audio output."
            )
            return None

    async def synthesize_streaming(self, text: str):
        """Yield audio chunks as they're synthesized (for lower latency).

        Yields raw MP3 chunks — caller must decode or buffer.
        """
        if edge_tts is None:
            return

        try:
            communicate = edge_tts.Communicate(text, self.voice)
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]
        except Exception as e:
            logger.error(f"TTS streaming failed: {e}")
