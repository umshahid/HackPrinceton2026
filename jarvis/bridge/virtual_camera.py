"""Send HUD frames to WhatsApp via a virtual camera (OBS Virtual Camera)."""

import asyncio
import numpy as np
from loguru import logger

from jarvis.config import VIRTUAL_CAM_WIDTH, VIRTUAL_CAM_HEIGHT, VIRTUAL_CAM_FPS

try:
    import pyvirtualcam
except ImportError:
    pyvirtualcam = None


class VirtualCamera:
    """Outputs HUD frames to a virtual camera that WhatsApp picks up as a webcam."""

    def __init__(self, width: int = None, height: int = None, fps: int = None):
        self.width = width or VIRTUAL_CAM_WIDTH
        self.height = height or VIRTUAL_CAM_HEIGHT
        self.fps = fps or VIRTUAL_CAM_FPS
        self._cam = None
        self._current_frame: np.ndarray | None = None
        self._lock = asyncio.Lock()
        self._running = False

    def start(self):
        """Initialize and start the virtual camera."""
        if pyvirtualcam is None:
            logger.error(
                "pyvirtualcam not installed. Install with: pip install pyvirtualcam\n"
                "Also install OBS Studio for the virtual camera driver."
            )
            return False

        try:
            self._cam = pyvirtualcam.Camera(
                width=self.width,
                height=self.height,
                fps=self.fps,
                fmt=pyvirtualcam.PixelFormat.RGB,
            )
            logger.info(
                f"Virtual camera started: {self._cam.device} "
                f"({self.width}x{self.height} @ {self.fps}fps)"
            )
            # Start with a black frame
            self._current_frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
            self._running = True
            return True
        except Exception as e:
            logger.error(f"Failed to start virtual camera: {e}")
            logger.error("Make sure OBS Virtual Camera is installed (install OBS Studio)")
            return False

    def send_frame(self, frame: np.ndarray):
        """Send a single frame to the virtual camera.

        Args:
            frame: RGB numpy array of shape (height, width, 3), dtype uint8.
                   Will be resized if dimensions don't match.
        """
        if self._cam is None:
            return

        # Resize if needed
        if frame.shape[1] != self.width or frame.shape[0] != self.height:
            try:
                import cv2
                frame = cv2.resize(frame, (self.width, self.height))
            except ImportError:
                # Manual nearest-neighbor resize with numpy
                y_ratio = frame.shape[0] / self.height
                x_ratio = frame.shape[1] / self.width
                y_idx = (np.arange(self.height) * y_ratio).astype(int)
                x_idx = (np.arange(self.width) * x_ratio).astype(int)
                frame = frame[np.ix_(y_idx, x_idx)]

        self._cam.send(frame)

    async def send_frame_async(self, frame: np.ndarray):
        """Send a frame asynchronously."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self.send_frame, frame)

    async def run_frame_loop(self):
        """Continuously send the current frame at the configured FPS.

        Update the frame by calling update_frame(). This loop ensures
        consistent frame rate even when the HUD renderer is slower.
        """
        self._running = True
        interval = 1.0 / self.fps
        logger.info(f"Virtual camera frame loop started at {self.fps} FPS")

        while self._running:
            async with self._lock:
                frame = self._current_frame

            if frame is not None:
                await self.send_frame_async(frame)

            await asyncio.sleep(interval)

    async def update_frame(self, frame: np.ndarray):
        """Update the frame that the frame loop will send."""
        async with self._lock:
            self._current_frame = frame

    def stop(self):
        """Stop and close the virtual camera."""
        self._running = False
        if self._cam is not None:
            self._cam.close()
            self._cam = None
        logger.info("Virtual camera stopped")
