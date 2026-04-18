"""Local preview mode — run HUD on screen + use PC mic/speakers. No extra installs needed."""

import asyncio
import queue
import threading
import numpy as np
from loguru import logger

from jarvis.config import VIRTUAL_CAM_WIDTH, VIRTUAL_CAM_HEIGHT, VIRTUAL_CAM_FPS, AUDIO_SAMPLE_RATE

try:
    import pygame
except ImportError:
    pygame = None

try:
    import sounddevice as sd
except ImportError:
    sd = None


class LocalPreview:
    """All-in-one local preview: shows HUD in a window, captures mic, plays audio through speakers.

    No virtual camera or virtual mic needed. Perfect for development and testing.
    """

    def __init__(self, width: int = None, height: int = None):
        self.width = width or VIRTUAL_CAM_WIDTH
        self.height = height or VIRTUAL_CAM_HEIGHT
        self._running = False
        self._current_frame: np.ndarray | None = None
        self._frame_lock = threading.Lock()

        # Audio playback queue
        self._audio_queue: queue.Queue[np.ndarray] = queue.Queue(maxsize=500)

        # Audio capture queue (mic input)
        self._mic_queue: queue.Queue[bytes] = queue.Queue(maxsize=200)

        # Pygame runs in its own thread (needs to own the main thread on some OS)
        self._pygame_thread: threading.Thread | None = None

        # Audio streams
        self._mic_stream = None
        self._speaker_stream = None

    def start(self) -> bool:
        """Start the local preview (display window + audio devices)."""
        self._running = True

        # Start audio
        self._start_audio()

        # Start pygame display in a thread
        if pygame is not None:
            self._pygame_thread = threading.Thread(target=self._pygame_loop, daemon=True)
            self._pygame_thread.start()
            logger.info(f"Local preview window started ({self.width}x{self.height})")
        else:
            logger.warning("pygame not installed — no visual preview. Install with: pip install pygame")

        return True

    def _start_audio(self):
        """Start mic capture and speaker output using sounddevice."""
        if sd is None:
            logger.warning("sounddevice not installed — no audio. Install with: pip install sounddevice")
            return

        # Mic capture (input)
        def mic_callback(indata, frames, time_info, status):
            if status:
                logger.debug(f"Mic status: {status}")
            try:
                self._mic_queue.put_nowait(indata.copy().tobytes())
            except queue.Full:
                pass

        try:
            self._mic_stream = sd.InputStream(
                samplerate=AUDIO_SAMPLE_RATE,
                channels=1,
                dtype="int16",
                blocksize=int(AUDIO_SAMPLE_RATE * 0.03),  # 30ms
                callback=mic_callback,
            )
            self._mic_stream.start()
            logger.info("Mic capture started (PC microphone)")
        except Exception as e:
            logger.error(f"Failed to start mic: {e}")

        # Speaker output
        def speaker_callback(outdata, frames, time_info, status):
            if status:
                logger.debug(f"Speaker status: {status}")
            try:
                data = self._audio_queue.get_nowait()
                if len(data) < frames:
                    padded = np.zeros(frames, dtype=np.int16)
                    padded[:len(data)] = data
                    data = padded
                elif len(data) > frames:
                    data = data[:frames]
                outdata[:, 0] = data.astype(np.float32) / 32768.0
            except queue.Empty:
                outdata.fill(0)

        try:
            self._speaker_stream = sd.OutputStream(
                samplerate=AUDIO_SAMPLE_RATE,
                channels=1,
                dtype="float32",
                blocksize=int(AUDIO_SAMPLE_RATE * 0.02),  # 20ms
                callback=speaker_callback,
            )
            self._speaker_stream.start()
            logger.info("Speaker output started (PC speakers)")
        except Exception as e:
            logger.error(f"Failed to start speaker output: {e}")

    def _pygame_loop(self):
        """Pygame display loop (runs in its own thread)."""
        pygame.init()
        screen = pygame.display.set_mode((self.width, self.height))
        pygame.display.set_caption("JARVIS — Local Preview")
        clock = pygame.time.Clock()

        # Set window icon color (dark theme)
        icon = pygame.Surface((32, 32))
        icon.fill((0, 100, 200))
        pygame.display.set_icon(icon)

        while self._running:
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    self._running = False
                    return
                elif event.type == pygame.KEYDOWN:
                    if event.key == pygame.K_ESCAPE:
                        self._running = False
                        return

            # Get the current HUD frame
            with self._frame_lock:
                frame = self._current_frame

            if frame is not None:
                # Convert numpy RGB to pygame surface
                # Pygame expects (width, height) but numpy is (height, width)
                surface = pygame.surfarray.make_surface(frame.swapaxes(0, 1))
                screen.blit(surface, (0, 0))
            else:
                screen.fill((0, 0, 0))

            pygame.display.flip()
            clock.tick(VIRTUAL_CAM_FPS)

        pygame.quit()

    # --- Interface matching VirtualCamera + VirtualMic + AudioCapturer ---

    def send_frame(self, frame: np.ndarray):
        """Update the display frame (same interface as VirtualCamera)."""
        with self._frame_lock:
            self._current_frame = frame

    async def send_frame_async(self, frame: np.ndarray):
        self.send_frame(frame)

    async def update_frame(self, frame: np.ndarray):
        self.send_frame(frame)

    def write_audio(self, audio_data: bytes | np.ndarray):
        """Queue audio for speaker playback (same interface as VirtualMic)."""
        if isinstance(audio_data, bytes):
            audio_data = np.frombuffer(audio_data, dtype=np.int16)

        chunk_size = int(AUDIO_SAMPLE_RATE * 0.02)
        for i in range(0, len(audio_data), chunk_size):
            chunk = audio_data[i:i + chunk_size]
            try:
                self._audio_queue.put_nowait(chunk)
            except queue.Full:
                break

    async def write_audio_async(self, audio_data: bytes | np.ndarray):
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self.write_audio, audio_data)

    def read_chunk(self, timeout: float = 0.1) -> bytes | None:
        """Read a mic audio chunk (same interface as AudioCapturer)."""
        try:
            return self._mic_queue.get(timeout=timeout)
        except queue.Empty:
            return None

    async def read_chunk_async(self, timeout: float = 0.1) -> bytes | None:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.read_chunk, timeout)

    def stop(self):
        """Stop everything."""
        self._running = False
        if self._mic_stream:
            self._mic_stream.stop()
            self._mic_stream.close()
        if self._speaker_stream:
            self._speaker_stream.stop()
            self._speaker_stream.close()
        if pygame is not None:
            try:
                pygame.quit()
            except Exception:
                pass
        logger.info("Local preview stopped")

    @property
    def running(self) -> bool:
        return self._running
