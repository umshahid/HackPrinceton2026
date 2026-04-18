"""Capture the glasses camera feed from the WhatsApp Desktop video call window."""

import asyncio
import time
import numpy as np
from loguru import logger

try:
    import mss
except ImportError:
    mss = None

try:
    import cv2
except ImportError:
    cv2 = None

try:
    import pygetwindow as gw
except ImportError:
    gw = None

from jarvis.config import WHATSAPP_WINDOW_TITLE


class VideoCapturer:
    """Captures frames from the WhatsApp video call window (incoming video = glasses camera)."""

    def __init__(self):
        self._running = False
        self._latest_frame: np.ndarray | None = None
        self._lock = asyncio.Lock()
        self._capture_region: dict | None = None

    def find_whatsapp_window(self) -> dict | None:
        """Find the WhatsApp Desktop window and return its bounding box."""
        if gw is None:
            logger.warning("pygetwindow not installed, using full screen capture")
            return None

        windows = gw.getWindowsWithTitle(WHATSAPP_WINDOW_TITLE)
        if not windows:
            logger.warning(f"No window found with title containing '{WHATSAPP_WINDOW_TITLE}'")
            return None

        win = windows[0]
        if win.isMinimized:
            win.restore()

        return {
            "left": win.left,
            "top": win.top,
            "width": win.width,
            "height": win.height,
        }

    def _capture_frame_sync(self) -> np.ndarray | None:
        """Capture a single frame from the WhatsApp window (runs in thread)."""
        if mss is None:
            logger.error("mss not installed")
            return None

        with mss.mss() as sct:
            if self._capture_region:
                region = self._capture_region
            else:
                # Fallback: capture primary monitor
                region = sct.monitors[1]

            screenshot = sct.grab(region)
            frame = np.array(screenshot)
            # mss returns BGRA, convert to RGB
            frame = frame[:, :, :3]  # Drop alpha
            frame = frame[:, :, ::-1]  # BGR -> RGB
            return frame

    async def capture_frame(self) -> np.ndarray | None:
        """Capture a single frame asynchronously."""
        loop = asyncio.get_event_loop()
        frame = await loop.run_in_executor(None, self._capture_frame_sync)
        if frame is not None:
            async with self._lock:
                self._latest_frame = frame
        return frame

    async def get_latest_frame(self) -> np.ndarray | None:
        """Get the most recently captured frame."""
        async with self._lock:
            return self._latest_frame

    async def start_continuous_capture(self, fps: int = 10):
        """Continuously capture frames at the given FPS."""
        self._running = True
        interval = 1.0 / fps
        logger.info(f"Starting video capture at {fps} FPS")

        # Find WhatsApp window
        self._capture_region = self.find_whatsapp_window()
        if self._capture_region:
            logger.info(f"Capturing WhatsApp window: {self._capture_region}")
        else:
            logger.info("Capturing full screen as fallback")

        while self._running:
            start = time.monotonic()
            await self.capture_frame()
            elapsed = time.monotonic() - start
            sleep_time = max(0, interval - elapsed)
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)

    def stop(self):
        """Stop continuous capture."""
        self._running = False
        logger.info("Video capture stopped")

    def refresh_window_position(self):
        """Re-detect the WhatsApp window position (call if window moves)."""
        self._capture_region = self.find_whatsapp_window()
