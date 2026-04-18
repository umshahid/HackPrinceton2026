"""Central configuration for Jarvis Glasses."""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Paths
PROJECT_ROOT = Path(__file__).parent.parent
ASSETS_DIR = PROJECT_ROOT / "assets"
FONTS_DIR = ASSETS_DIR / "fonts"
SOUNDS_DIR = ASSETS_DIR / "sounds"

# API Keys
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_CODE_PATH = os.getenv("CLAUDE_CODE_PATH", "claude")

# Virtual Camera
VIRTUAL_CAM_WIDTH = int(os.getenv("VIRTUAL_CAM_WIDTH", "1280"))
VIRTUAL_CAM_HEIGHT = int(os.getenv("VIRTUAL_CAM_HEIGHT", "720"))
VIRTUAL_CAM_FPS = int(os.getenv("VIRTUAL_CAM_FPS", "20"))

# WhatsApp
WHATSAPP_WINDOW_TITLE = os.getenv("WHATSAPP_WINDOW_TITLE", "WhatsApp")

# Audio
AUDIO_SAMPLE_RATE = 16000  # 16kHz for speech
AUDIO_CHANNELS = 1         # Mono
AUDIO_CHUNK_MS = 30        # 30ms chunks for VAD

# AI Engine
DEFAULT_AI_ENGINE = os.getenv("DEFAULT_AI_ENGINE", "gemini_live")

# HUD
HUD_BG_COLOR = (0, 0, 0)           # Black background
HUD_TEXT_COLOR = (0, 200, 255)      # Cyan/blue Jarvis color
HUD_ACCENT_COLOR = (0, 150, 255)   # Accent blue
HUD_WARNING_COLOR = (255, 165, 0)  # Orange for warnings
HUD_FONT_SIZE = 28
HUD_PADDING = 20
