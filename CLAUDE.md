# Jarvis Glasses

Iron Man Jarvis-style AI assistant using Meta Ray-Ban display glasses.

## Architecture
- WhatsApp video call = bidirectional I/O (audio + video) between glasses and PC
- PC captures glasses camera/mic from WhatsApp, sends HUD frames + AI audio back via virtual camera/mic
- AI engine is pluggable: Gemini Live (primary), Claude (complex tasks), Local LLM (offline)
- Python 3.13, asyncio-based, Windows 11

## Project Structure
- `jarvis/bridge/` — WhatsApp video call I/O (capture + virtual devices)
- `jarvis/audio/` — VAD, STT, TTS
- `jarvis/ai/` — Pluggable AI engines (Gemini Live, Claude, Local)
- `jarvis/actions/` — PC control tools (system, web, files, Claude Code)
- `jarvis/hud/` — HUD frame rendering + themes
- `jarvis/main.py` — Orchestrator / entry point

## Running
```bash
# Local preview (no extra installs — HUD in window, PC mic + speakers)
python -m jarvis.main

# WhatsApp Desktop mode (screen share HUD + VB-Cable audio)
python -m jarvis.main --mode whatsapp
```

## Bridge Modes
- **local** (default): Pygame window for HUD, PC mic/speakers. Best for development.
- **whatsapp**: HUD window screen-shared via WhatsApp Desktop video call. AI audio via VB-Cable, glasses mic via WASAPI loopback. Requires VB-Audio Cable + physical webcam (for call init).
