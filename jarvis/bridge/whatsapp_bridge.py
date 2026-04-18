"""WhatsApp Desktop bridge — HUD window for screen sharing + VB-Cable + WASAPI loopback.

How it works:
1. Opens a pygame window showing the HUD (user screen-shares this in WhatsApp)
2. AI audio → VB-Cable → WhatsApp mic input → glasses speakers
3. Glasses mic → WhatsApp audio output → WASAPI loopback capture → AI
4. Glasses camera → WhatsApp video → screen capture of WhatsApp window → AI vision

Prerequisites:
- WhatsApp Desktop (Microsoft Store)
- Physical webcam (needed to start video call — can be any cheap USB cam)
- VB-Audio Virtual Cable installed (https://vb-audio.com/Cable/)

Flow:
1. Start Jarvis with --mode whatsapp
2. Open WhatsApp Desktop, start video call to glasses
3. Once connected, screen-share the "JARVIS HUD" window
4. In WhatsApp settings, set microphone to "CABLE Input (VB-Audio Virtual Cable)"
"""

import asyncio
import queue
import threading
import numpy as np
from loguru import logger

from jarvis.config import (
    VIRTUAL_CAM_WIDTH, VIRTUAL_CAM_HEIGHT, VIRTUAL_CAM_FPS,
    AUDIO_SAMPLE_RATE, WHATSAPP_WINDOW_TITLE,
)

try:
    import pygame
except ImportError:
    pygame = None

from jarvis.bridge.virtual_mic import VirtualMic
from jarvis.bridge.audio_capture import AudioCapturer
from jarvis.bridge.video_capture import VideoCapturer


class WhatsAppBridge:
    """All-in-one bridge for WhatsApp Desktop: HUD window + audio I/O + video capture.

    Components:
    - display: Pygame window titled "JARVIS HUD" (screen-shared via WhatsApp)
    - audio_out: VB-Cable virtual mic (AI voice → WhatsApp → glasses speakers)
    - audio_in: WASAPI loopback (glasses mic → WhatsApp audio → capture)
    - video_in: Screen capture of WhatsApp window (glasses camera feed)
    """

    def __init__(self):
        self._running = False

        # Display — pygame window for HUD (screen-shared in WhatsApp)
        self._current_frame: np.ndarray | None = None
        self._frame_lock = threading.Lock()
        self._pygame_thread: threading.Thread | None = None

        # Audio out — VB-Cable
        self._vmic = VirtualMic()

        # Audio in — WASAPI loopback
        self._acap = AudioCapturer()

        # Video in — screen capture of WhatsApp window
        self._vcap = VideoCapturer()

    def start(self) -> bool:
        """Start all bridge components."""
        self._running = True
        ok = True

        # 1. Start HUD window
        if pygame is not None:
            self._pygame_thread = threading.Thread(target=self._pygame_loop, daemon=True)
            self._pygame_thread.start()
            logger.info(f"HUD window started ({VIRTUAL_CAM_WIDTH}x{VIRTUAL_CAM_HEIGHT})")
        else:
            logger.error("pygame not installed — HUD window won't work")
            ok = False

        # 2. Start VB-Cable output (AI audio → WhatsApp mic)
        if not self._vmic.start():
            logger.warning(
                "VB-Cable not found — AI audio won't reach glasses.\n"
                "Install VB-Audio Virtual Cable: https://vb-audio.com/Cable/\n"
                "Then set WhatsApp microphone to 'CABLE Input' in WhatsApp settings."
            )
            # Not fatal — HUD still works

        # 3. Start WASAPI loopback capture (glasses mic → AI)
        self._acap.start()

        # 4. Video capture gets started later when WhatsApp window is detected
        logger.info("─" * 50)
        logger.info("  SETUP INSTRUCTIONS:")
        logger.info("  1. Open WhatsApp Desktop")
        logger.info("  2. Start a video call to your glasses")
        logger.info("  3. Screen-share the 'JARVIS HUD' window")
        logger.info("  4. Set WhatsApp mic to 'CABLE Input (VB-Audio Virtual Cable)'")
        logger.info("─" * 50)

        return ok

    def _pygame_loop(self):
        """Pygame display loop — renders HUD in a shareable window."""
        pygame.init()

        # Window title matters — user will search for this in WhatsApp screen share
        screen = pygame.display.set_mode((VIRTUAL_CAM_WIDTH, VIRTUAL_CAM_HEIGHT))
        pygame.display.set_caption("JARVIS HUD")
        clock = pygame.time.Clock()

        # Dark icon
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

            with self._frame_lock:
                frame = self._current_frame

            if frame is not None:
                surface = pygame.surfarray.make_surface(frame.swapaxes(0, 1))
                screen.blit(surface, (0, 0))
            else:
                screen.fill((0, 0, 0))

            pygame.display.flip()
            clock.tick(VIRTUAL_CAM_FPS)

        pygame.quit()

    # --- Display interface (same as LocalPreview / VirtualCamera) ---

    def send_frame(self, frame: np.ndarray):
        """Update the HUD frame shown in the pygame window."""
        with self._frame_lock:
            self._current_frame = frame

    async def send_frame_async(self, frame: np.ndarray):
        self.send_frame(frame)

    async def update_frame(self, frame: np.ndarray):
        self.send_frame(frame)

    # --- Audio out interface (delegates to VirtualMic) ---

    def write_audio(self, audio_data: bytes | np.ndarray):
        """Send AI audio to VB-Cable → WhatsApp → glasses speakers."""
        self._vmic.write_audio(audio_data)

    async def write_audio_async(self, audio_data: bytes | np.ndarray):
        await self._vmic.write_audio_async(audio_data)

    # --- Audio in interface (delegates to AudioCapturer) ---

    def read_chunk(self, timeout: float = 0.1) -> bytes | None:
        """Read glasses mic audio captured via WASAPI loopback."""
        return self._acap.read_chunk(timeout)

    async def read_chunk_async(self, timeout: float = 0.1) -> bytes | None:
        return await self._acap.read_chunk_async(timeout)

    # --- Video in interface (delegates to VideoCapturer) ---

    async def capture_frame(self) -> np.ndarray | None:
        """Capture glasses camera frame from WhatsApp window."""
        return await self._vcap.capture_frame()

    def refresh_whatsapp_window(self):
        """Re-detect WhatsApp window position (call if window moved)."""
        self._vcap.refresh_window_position()

    # --- Lifecycle ---

    def stop(self):
        """Stop all bridge components."""
        self._running = False
        self._vmic.stop()
        self._acap.stop()
        self._vcap.stop()
        if pygame is not None:
            try:
                pygame.quit()
            except Exception:
                pass
        logger.info("WhatsApp bridge stopped")

    @property
    def running(self) -> bool:
        return self._running
