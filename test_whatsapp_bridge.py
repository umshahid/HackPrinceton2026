"""Test script for WhatsApp bridge — runs HUD demo + captures audio + plays test tones."""

import asyncio
import numpy as np
import time
import random
from loguru import logger

from jarvis.config import VIRTUAL_CAM_FPS, AUDIO_SAMPLE_RATE
from jarvis.utils.logging import setup_logging
from jarvis.hud.renderer import HUDRenderer
from jarvis.bridge.whatsapp_bridge import WhatsAppBridge


def generate_tone(freq: float, duration: float, sample_rate: int = AUDIO_SAMPLE_RATE) -> bytes:
    """Generate a sine wave tone as PCM int16 bytes."""
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
    # Sine wave with fade in/out to avoid clicks
    wave = np.sin(2 * np.pi * freq * t)
    fade_samples = min(int(sample_rate * 0.02), len(wave) // 4)
    wave[:fade_samples] *= np.linspace(0, 1, fade_samples)
    wave[-fade_samples:] *= np.linspace(1, 0, fade_samples)
    pcm = (wave * 20000).astype(np.int16)  # Not too loud
    return pcm.tobytes()


def generate_jarvis_startup_sound() -> bytes:
    """Generate a Jarvis-like startup chime (ascending tones)."""
    tones = [
        (440, 0.15),   # A4
        (554, 0.15),   # C#5
        (659, 0.15),   # E5
        (880, 0.3),    # A5 (held longer)
    ]
    audio = b""
    for freq, dur in tones:
        audio += generate_tone(freq, dur)
        audio += b"\x00\x00" * int(AUDIO_SAMPLE_RATE * 0.05)  # tiny gap
    return audio


async def main():
    setup_logging()

    bridge = WhatsAppBridge()
    hud = HUDRenderer()

    if not bridge.start():
        logger.error("Bridge failed to start")
        return

    logger.info("")
    logger.info("=" * 60)
    logger.info("  TEST MODE — Do this now:")
    logger.info("  1. Start video call in WhatsApp Desktop")
    logger.info("  2. Screen-share the 'JARVIS HUD' window")
    logger.info("  3. Set WhatsApp mic to 'CABLE Input'")
    logger.info("  4. Talk into your glasses mic — watch for audio levels below")
    logger.info("")
    logger.info("  Test tones will play every 10 seconds through VB-Cable")
    logger.info("  (you should hear them on your glasses)")
    logger.info("=" * 60)
    logger.info("")

    running = True
    audio_chunks_received = 0
    max_level_seen = 0.0
    last_tone_time = 0
    tone_count = 0
    startup_sound = generate_jarvis_startup_sound()

    # Demo states
    demos = [
        ("ONLINE", "JARVIS ONLINE — All systems operational", 5),
        ("LISTENING", "Listening for voice input...", 4),
        ("THINKING", "Processing query...", 3),
        ("SPEAKING", "", 5),
        ("ONLINE", "Standing by.", 5),
    ]
    demo_idx = 0
    demo_switch_time = time.time() + 3  # Start first state after 3s

    try:
        while running:
            # --- HUD rendering ---
            now = time.time()

            # Cycle demo states
            if now > demo_switch_time:
                status, notif, dur = demos[demo_idx % len(demos)]
                hud.state.status = status
                if notif:
                    hud.state.set_notification(notif, duration=dur)
                if status == "SPEAKING":
                    hud.state.response_text = "Testing audio output to glasses..."
                elif status == "LISTENING":
                    hud.state.response_text = ""
                else:
                    hud.state.response_text = ""
                demo_idx += 1
                demo_switch_time = now + dur

            # Simulate mic visualization during LISTENING
            if hud.state.status == "LISTENING":
                hud.state.update_mic_level(random.uniform(0.2, 0.8))
            else:
                hud.state.update_mic_level(random.uniform(0.0, 0.05))

            frame = hud.render_frame()
            bridge.send_frame(frame)

            # --- Audio capture (glasses mic → PC) ---
            chunk = await bridge.read_chunk_async(timeout=0.01)
            if chunk is not None and len(chunk) > 0:
                audio_chunks_received += 1
                audio_array = np.frombuffer(chunk, dtype=np.int16)
                level = float(np.sqrt(np.mean(audio_array.astype(np.float32) ** 2))) / 32768.0

                if level > max_level_seen:
                    max_level_seen = level

                # Log audio level periodically
                if audio_chunks_received % 50 == 0:
                    bar = "█" * int(level * 50)
                    logger.info(
                        f"🎤 AUDIO IN: chunks={audio_chunks_received}, "
                        f"level={level:.4f}, max={max_level_seen:.4f} |{bar}|"
                    )

            # --- Audio output (test tones → glasses) ---
            if now - last_tone_time > 10:
                tone_count += 1
                if tone_count == 1:
                    # First tone: play startup chime
                    logger.info("🔊 Playing Jarvis startup chime → glasses...")
                    await bridge.write_audio_async(startup_sound)
                else:
                    # Subsequent: play a beep
                    freq = 440 + (tone_count * 100)  # Ascending pitch each time
                    tone = generate_tone(freq, 0.5)
                    logger.info(f"🔊 Playing test tone #{tone_count} ({freq}Hz) → glasses...")
                    await bridge.write_audio_async(tone)
                last_tone_time = now

            await asyncio.sleep(1.0 / VIRTUAL_CAM_FPS)

    except KeyboardInterrupt:
        pass
    finally:
        logger.info("")
        logger.info("=" * 40)
        logger.info(f"  RESULTS:")
        logger.info(f"  Audio chunks captured: {audio_chunks_received}")
        logger.info(f"  Max audio level: {max_level_seen:.4f}")
        logger.info(f"  Test tones played: {tone_count}")
        if audio_chunks_received > 0:
            logger.info("  ✓ Audio capture is WORKING")
        else:
            logger.info("  ✗ No audio captured — check WASAPI loopback setup")
        logger.info("=" * 40)
        bridge.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nTest ended.")
