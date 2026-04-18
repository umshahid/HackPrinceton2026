"""Jarvis Glasses — Main orchestrator.

This is the entry point that ties all modules together:
1. Starts the bridge (local preview or WhatsApp Desktop)
2. Initializes the AI engine
3. Runs the main event loop: capture → AI → actions → HUD → display

Usage:
    python -m jarvis.main                    # Local preview (default, no extra installs)
    python -m jarvis.main --mode whatsapp    # WhatsApp Desktop (VB-Cable + screen share)
"""

import argparse
import asyncio
import signal
import sys
import numpy as np
from loguru import logger

from jarvis.config import VIRTUAL_CAM_FPS, DEFAULT_AI_ENGINE
from jarvis.utils.logging import setup_logging
from jarvis.audio.vad import VoiceActivityDetector
from jarvis.audio.tts import TextToSpeech
from jarvis.hud.renderer import HUDRenderer
from jarvis.actions.registry import ActionRegistry
from jarvis.actions.system import register_system_actions
from jarvis.actions.web import register_web_actions
from jarvis.actions.claude_code import register_claude_code_actions


class Jarvis:
    """Main Jarvis orchestrator."""

    def __init__(self, mode: str = "local", demo: bool = False):
        """
        Args:
            mode: Bridge mode — "local" (preview window) or "whatsapp" (WhatsApp Desktop).
            demo: If True, run a demo loop cycling through HUD states.
        """
        self.mode = mode
        self.demo = demo

        # These get set up in initialize() based on mode
        self.display = None       # Where HUD frames go (preview window / WhatsApp screen share)
        self.audio_out = None     # Where AI audio goes (speakers / VB-Cable)
        self.audio_in = None      # Where mic audio comes from (PC mic / WASAPI loopback)
        self.video_in = None      # Where glasses camera comes from (WhatsApp window capture)

        # Processing
        self.vad = VoiceActivityDetector()
        self.tts = TextToSpeech()
        self.hud = HUDRenderer()

        # AI Engine (initialized later)
        self.ai_engine = None

        # State
        self._running = False
        self._audio_buffer: list[bytes] = []
        self._current_frame: np.ndarray | None = None
        self._frame_send_counter = 0

    async def initialize(self):
        """Initialize all components."""
        logger.info("=" * 50)
        logger.info(f"  JARVIS GLASSES — Mode: {self.mode.upper()}")
        logger.info("=" * 50)

        # Register all actions
        register_system_actions()
        register_web_actions()
        register_claude_code_actions()
        logger.info(f"Registered {len(ActionRegistry.get_instance().actions)} actions")

        # Initialize AI engine
        await self._init_ai_engine()

        # Initialize bridge based on mode
        await self._init_bridge()

        logger.info("Jarvis initialized successfully!")
        self.hud.state.set_notification("JARVIS ONLINE", duration=3.0)

    async def _init_bridge(self):
        """Set up I/O bridge based on mode."""

        if self.mode == "local":
            from jarvis.bridge.local_preview import LocalPreview
            preview = LocalPreview()
            preview.start()
            # LocalPreview handles display + audio_out + audio_in all in one
            self.display = preview
            self.audio_out = preview
            self.audio_in = preview
            self.video_in = None  # No glasses camera in local mode
            logger.info("Local preview mode — HUD in window, using PC mic + speakers")

        elif self.mode == "whatsapp":
            from jarvis.bridge.whatsapp_bridge import WhatsAppBridge
            bridge = WhatsAppBridge()
            if bridge.start():
                self.display = bridge
                self.audio_out = bridge
                self.audio_in = bridge
                self.video_in = bridge
                logger.info("WhatsApp mode — HUD window + VB-Cable + WASAPI loopback")
            else:
                logger.error("WhatsApp bridge failed, falling back to local preview")
                await self._fallback_to_local()

        else:
            logger.error(f"Unknown mode: {self.mode}")
            await self._fallback_to_local()

    async def _fallback_to_local(self):
        """Fall back to local preview mode."""
        from jarvis.bridge.local_preview import LocalPreview
        preview = LocalPreview()
        preview.start()
        self.display = preview
        self.audio_out = preview
        self.audio_in = preview
        self.video_in = None
        self.mode = "local"

    async def _init_ai_engine(self):
        """Initialize the configured AI engine."""
        if DEFAULT_AI_ENGINE == "gemini_live":
            from jarvis.ai.gemini_live import GeminiLiveEngine
            self.ai_engine = GeminiLiveEngine()
        elif DEFAULT_AI_ENGINE == "claude":
            from jarvis.ai.claude_engine import ClaudeEngine
            self.ai_engine = ClaudeEngine()
        else:
            logger.error(f"Unknown AI engine: {DEFAULT_AI_ENGINE}")
            return

        try:
            await self.ai_engine.initialize()
            logger.info(f"AI engine '{self.ai_engine.name}' initialized")
        except Exception as e:
            logger.error(f"Failed to initialize AI engine: {e}")
            logger.info("Jarvis will run without AI. Fix the error and restart.")
            self.ai_engine = None

    async def run(self):
        """Main event loop."""
        self._running = True

        tasks = [
            asyncio.create_task(self._hud_loop(), name="hud_loop"),
        ]

        # Audio loop (always, if we have audio input)
        if self.audio_in:
            tasks.append(asyncio.create_task(self._audio_loop(), name="audio_loop"))

        # Video capture loop (only if we have a video source)
        if self.video_in:
            tasks.append(asyncio.create_task(self._video_capture_loop(), name="video_capture"))

        # Gemini Live streaming session
        if self.ai_engine and self.ai_engine.supports_audio_streaming:
            tasks.append(asyncio.create_task(self._gemini_live_loop(), name="gemini_live"))

        # Demo mode — cycle through states to showcase HUD
        if self.demo:
            tasks.append(asyncio.create_task(self._demo_loop(), name="demo"))

        logger.info("Jarvis is running. Press Ctrl+C to stop.")

        try:
            await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            logger.info("Jarvis tasks cancelled")

    async def _audio_loop(self):
        """Capture and process audio from mic input."""
        while self._running:
            chunk = await self.audio_in.read_chunk_async(timeout=0.05)
            if chunk is None:
                continue

            # Update mic level on HUD
            audio_array = np.frombuffer(chunk, dtype=np.int16)
            level = float(np.sqrt(np.mean(audio_array.astype(np.float32) ** 2))) / 32768.0
            self.hud.state.update_mic_level(min(1.0, level * 5))  # Amplify for visibility

            is_speaking = self.vad.process_chunk(chunk)

            if is_speaking:
                self.hud.state.status = "LISTENING"
                self._audio_buffer.append(chunk)
            elif self._audio_buffer:
                self.hud.state.status = "THINKING"
                audio_data = b"".join(self._audio_buffer)
                self._audio_buffer.clear()

                if self.ai_engine and not self.ai_engine.supports_audio_streaming:
                    asyncio.create_task(self._process_speech(audio_data))
                else:
                    # No AI connected — return to ONLINE after brief "thinking" display
                    await asyncio.sleep(0.5)
                    self.hud.state.status = "ONLINE"

    async def _process_speech(self, audio_data: bytes):
        """Process a complete speech utterance (non-streaming engines only)."""
        if self.ai_engine is None:
            return

        try:
            # TODO: Add STT (Whisper) for non-streaming engines
            logger.debug(f"Captured {len(audio_data)} bytes of speech")
            self.hud.state.status = "ONLINE"
        except Exception as e:
            logger.error(f"Speech processing error: {e}")
            self.hud.state.status = "ONLINE"

    async def _gemini_live_loop(self):
        """Run the Gemini Live streaming session."""
        from jarvis.ai.gemini_live import GeminiLiveEngine

        if not isinstance(self.ai_engine, GeminiLiveEngine):
            return

        while self._running:
            try:
                logger.info("Starting Gemini Live session...")
                ctx = await self.ai_engine.start_session()

                async with ctx as session:
                    # Store the entered session so engine methods can use it
                    self.ai_engine._set_session(session)
                    logger.info("Gemini Live session active!")
                    self.hud.state.set_notification("AI CONNECTED", duration=3.0)

                    sender = asyncio.create_task(self._gemini_send_loop())
                    receiver = asyncio.create_task(self._gemini_receive_loop())
                    await asyncio.gather(sender, receiver)

            except Exception as e:
                logger.error(f"Gemini Live session error: {e}")
                self.hud.state.status = "ONLINE"
                self.hud.state.set_notification("Reconnecting to AI...", duration=3.0)
                await asyncio.sleep(3)

    async def _gemini_send_loop(self):
        """Send audio + video to Gemini Live."""
        from jarvis.ai.gemini_live import GeminiLiveEngine
        engine: GeminiLiveEngine = self.ai_engine

        while self._running:
            if self.audio_in:
                chunk = await self.audio_in.read_chunk_async(timeout=0.05)
                if chunk:
                    try:
                        await engine.send_audio(chunk)
                    except Exception as e:
                        logger.error(f"Error sending audio to Gemini: {e}")
                        break

            # Send video frame every ~3 seconds for vision context
            self._frame_send_counter += 1
            if self._current_frame is not None and self._frame_send_counter % 60 == 0:
                try:
                    await engine.send_image(self._current_frame)
                except Exception:
                    pass

    async def _gemini_receive_loop(self):
        """Receive responses from Gemini Live."""
        from jarvis.ai.gemini_live import GeminiLiveEngine
        engine: GeminiLiveEngine = self.ai_engine

        try:
            async for response in engine.receive_responses():
                if response.audio and self.audio_out:
                    self.hud.state.status = "SPEAKING"
                    await self.audio_out.write_audio_async(response.audio)

                if response.text:
                    self.hud.state.response_text = response.text
                    logger.info(f"Jarvis: {response.text}")

                if response.tool_calls:
                    for tool_call in response.tool_calls:
                        self.hud.state.status = "ACTION"
                        self.hud.state.action_text = f"Running: {tool_call.name}"
                        result = await ActionRegistry.get_instance().execute(
                            tool_call.name, tool_call.arguments
                        )
                        await engine.send_tool_result(tool_call.id, result)

                if not response.is_partial and not response.tool_calls:
                    self.hud.state.status = "ONLINE"
                    self.hud.state.action_text = ""

        except Exception as e:
            logger.error(f"Error receiving from Gemini: {e}")

    async def _video_capture_loop(self):
        """Capture video from glasses camera (WhatsApp window)."""
        while self._running:
            if hasattr(self.video_in, 'capture_frame'):
                frame = await self.video_in.capture_frame()
            else:
                frame = None

            if frame is not None:
                self._current_frame = frame
            await asyncio.sleep(0.5)

    async def _demo_loop(self):
        """Demo mode — cycle through HUD states to showcase the display."""
        import random

        demos = [
            ("ONLINE", "", "", "JARVIS ONLINE — All systems operational", 4),
            ("LISTENING", "", "", "Listening for voice input...", 3),
            ("THINKING", "", "", "Processing query...", 2),
            ("SPEAKING", "The current temperature in San Francisco is 64 degrees Fahrenheit with partly cloudy skies. Perfect weather for a walk, sir.", "", "", 6),
            ("ACTION", "", "Opening Google Chrome", "Executing system command...", 3),
            ("ACTION", "", "Searching: latest AI news", "Browsing the web...", 3),
            ("SPEAKING", "I found several interesting articles. The top story is about a new breakthrough in multimodal AI models that can process video in real-time.", "", "", 6),
            ("ONLINE", "", "", "", 3),
            ("LISTENING", "", "", "Voice detected — analyzing...", 3),
            ("THINKING", "", "", "", 2),
            ("ACTION", "", "Running: claude_code", "Delegating to Claude Code...", 4),
            ("SPEAKING", "Done. I've created the new API endpoint and added tests. The build is passing.", "", "", 5),
            ("ONLINE", "", "", "Standing by.", 4),
        ]

        logger.info("Demo mode started — cycling through HUD states")

        while self._running:
            for status, response, action, notif, duration in demos:
                if not self._running:
                    break

                self.hud.state.status = status
                self.hud.state.response_text = response
                self.hud.state.action_text = action
                if notif:
                    self.hud.state.set_notification(notif, duration=duration)

                # Simulate mic activity during LISTENING
                if status == "LISTENING":
                    for _ in range(int(duration * 20)):
                        if not self._running:
                            break
                        self.hud.state.update_mic_level(random.uniform(0.2, 0.9))
                        await asyncio.sleep(0.05)
                elif status == "THINKING":
                    # Quiet mic during thinking
                    for _ in range(int(duration * 10)):
                        self.hud.state.update_mic_level(random.uniform(0.0, 0.05))
                        await asyncio.sleep(0.1)
                else:
                    # Idle mic noise
                    for _ in range(int(duration * 10)):
                        if not self._running:
                            break
                        self.hud.state.update_mic_level(random.uniform(0.0, 0.08))
                        await asyncio.sleep(0.1)

            # Clear after full cycle
            self.hud.state.status = "ONLINE"
            self.hud.state.response_text = ""
            self.hud.state.action_text = ""
            self.hud.state.set_notification("Demo cycle complete — restarting...", duration=3.0)
            await asyncio.sleep(3)

    async def _hud_loop(self):
        """Render HUD frames and send to display."""
        interval = 1.0 / VIRTUAL_CAM_FPS

        while self._running:
            frame = self.hud.render_frame()

            if self.display:
                if asyncio.iscoroutinefunction(getattr(self.display, 'send_frame', None)):
                    await self.display.send_frame(frame)
                else:
                    self.display.send_frame(frame)

            self._frame_send_counter += 1
            await asyncio.sleep(interval)

    async def shutdown(self):
        """Clean up all resources."""
        logger.info("Shutting down Jarvis...")
        self._running = False

        for component in [self.audio_in, self.audio_out, self.display, self.video_in]:
            if component is None:
                continue
            try:
                if hasattr(component, 'stop'):
                    if asyncio.iscoroutinefunction(component.stop):
                        await component.stop()
                    else:
                        component.stop()
            except Exception as e:
                logger.debug(f"Cleanup error: {e}")

        if self.ai_engine:
            await self.ai_engine.shutdown()

        logger.info("Jarvis shut down complete.")


def parse_args():
    parser = argparse.ArgumentParser(description="Jarvis Glasses AI Assistant")
    parser.add_argument(
        "--mode", "-m",
        choices=["local", "whatsapp"],
        default="local",
        help="Bridge mode: 'local' (preview window, default), 'whatsapp' (WhatsApp Desktop + screen share)",
    )
    parser.add_argument(
        "--ai",
        choices=["gemini_live", "claude"],
        default=None,
        help="Override AI engine (default: from .env)",
    )
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Run demo mode — cycles through HUD states without AI",
    )
    return parser.parse_args()


async def main():
    """Entry point."""
    args = parse_args()
    setup_logging()

    # Override AI engine if specified
    if args.ai:
        import jarvis.config as cfg
        cfg.DEFAULT_AI_ENGINE = args.ai

    jarvis = Jarvis(mode=args.mode, demo=args.demo)

    try:
        await jarvis.initialize()
        await jarvis.run()
    except KeyboardInterrupt:
        pass
    finally:
        await jarvis.shutdown()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nJarvis terminated.")
