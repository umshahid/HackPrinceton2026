# Jarvis Glasses - Technical Project Plan

## Overview

An Iron Man Jarvis-style AI assistant that runs on your PC and interfaces with Meta Ray-Ban display glasses via a WhatsApp video call bridge. The AI sees what you see, hears what you say, speaks back, and renders a HUD on your glasses — all through a single WhatsApp call acting as the bidirectional I/O channel.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        YOUR PC (Windows 11)                         │
│                                                                      │
│  ┌─────────────┐    ┌──────────────────────────────────────────┐    │
│  │  WhatsApp    │    │           JARVIS CORE                    │    │
│  │  Desktop App │    │                                          │    │
│  │             ◄├────┤  ┌────────────┐   ┌─────────────────┐   │    │
│  │  - Joins    │    │  │ Audio      │   │ AI Engine       │   │    │
│  │    video    │    │  │ Pipeline   │   │ (Gemini Live /  │   │    │
│  │    call     │    │  │            │   │  Local LLM /    │   │    │
│  │             ├────►  │ - Capture  │   │  OpenAI)        │   │    │
│  │  Virtual    │    │  │ - VAD      │──►│                 │   │    │
│  │  Camera  ───┤    │  │ - STT      │   │ - Reasoning     │   │    │
│  │  Virtual    │    │  │            │◄──│ - Vision        │   │    │
│  │  Mic    ────┤    │  │ - TTS      │   │ - Planning      │   │    │
│  └─────────────┘    │  └────────────┘   └────────┬────────┘   │    │
│                      │                            │            │    │
│                      │  ┌────────────┐   ┌───────▼────────┐   │    │
│                      │  │ HUD        │   │ Action Engine  │   │    │
│                      │  │ Renderer   │   │                │   │    │
│                      │  │            │   │ - PC Control   │   │    │
│                      │  │ - Text     │   │ - Web Browse   │   │    │
│                      │  │ - Overlays │   │ - File Ops     │   │    │
│                      │  │ - Widgets  │   │ - App Launch   │   │    │
│                      │  │ - Notifs   │   │ - Claude Code  │   │    │
│                      │  └────────────┘   │ - Smart Home   │   │    │
│                      │                    └────────────────┘   │    │
│                      └──────────────────────────────────────────┘    │
│                                                                      │
│  ┌─────────────────┐                                                 │
│  │ Virtual Camera   │  (OBS Virtual Cam or pyvirtualcam)            │
│  │ Virtual Mic      │  (VB-Audio Cable or similar)                  │
│  └─────────────────┘                                                 │
└──────────────────────────────────────────────────────────────────────┘
          ▲                                          │
          │            WhatsApp Video Call            │
          │         (bidirectional audio+video)       │
          ▼                                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     META RAY-BAN GLASSES                             │
│                                                                      │
│  Camera ──► streams to PC via WhatsApp incoming video               │
│  Mic ──────► streams to PC via WhatsApp incoming audio              │
│  Speaker ◄── receives AI speech via WhatsApp outgoing audio         │
│  Display ◄── receives HUD frames via WhatsApp outgoing video        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Module Breakdown

### Module 1: WhatsApp Video Call Bridge
**Purpose:** Capture glasses A/V input, send HUD video + AI audio back.

**Components:**
- **Incoming video capture** — Grab the glasses camera feed from the WhatsApp Desktop window. Options:
  - Screen capture of the WhatsApp video call window (via `mss`, `dxcam`, or Windows Graphics Capture API)
  - Potentially hook into WhatsApp Web via browser automation
- **Incoming audio capture** — Capture the glasses mic audio arriving via WhatsApp. Options:
  - WASAPI loopback capture of WhatsApp's audio output (via `sounddevice` or `pyaudiowpatch`)
  - Route WhatsApp audio output through a virtual audio cable
- **Outgoing virtual camera** — Render HUD frames and feed to WhatsApp as "your camera". Options:
  - `pyvirtualcam` (uses OBS Virtual Camera driver)
  - Direct virtual camera via DirectShow
- **Outgoing virtual mic** — Feed TTS audio to WhatsApp as "your mic". Options:
  - VB-Audio Virtual Cable (route TTS output → virtual mic input)
  - `sounddevice` writing to a virtual audio device

**Key challenge:** Latency. WhatsApp encoding + network + decoding adds ~300-500ms. We minimize what we control.

### Module 2: Audio Pipeline
**Purpose:** Process voice input, generate voice output.

**Components:**
- **Voice Activity Detection (VAD)** — Detect when user is speaking vs silence. Use `silero-vad` (lightweight, accurate).
- **Speech-to-Text (STT)** — Transcribe user speech. Options:
  - Gemini Live handles this natively (audio-in, audio-out)
  - `faster-whisper` for local STT if using non-audio AI models
  - Google Cloud STT / Deepgram for streaming STT
- **Text-to-Speech (TTS)** — Generate Jarvis voice. Options:
  - Gemini Live handles this natively
  - `edge-tts` (free, good quality, low latency)
  - ElevenLabs (best quality, paid)
  - Local: `piper-tts` or `coqui-tts`
- **Wake word detection** (optional) — "Jarvis" trigger. Use `openwakeword` or `porcupine`.

**Note:** When using Gemini Live, the audio pipeline simplifies massively — it handles STT + reasoning + TTS in one streaming call.

### Module 3: AI Engine (Pluggable)
**Purpose:** The brain. Processes multimodal input, decides actions, generates responses.

**Interface (abstract):**
```python
class AIEngine:
    async def process_audio_stream(self, audio_chunks) -> AsyncIterator[AudioChunk]:
        """For streaming audio-native models like Gemini Live"""

    async def process_turn(self, text: str, image: Image = None) -> Response:
        """For text-based models with optional vision"""

    async def process_vision(self, frame: Image, query: str) -> str:
        """Analyze a camera frame"""
```

**Implementations:**
1. **GeminiLiveEngine** (primary) — Uses Gemini 2.0 Flash Multimodal Live API
   - Native audio-in/audio-out streaming
   - Native vision (send frames periodically)
   - Function calling for actions
   - Lowest perceived latency (streaming)
2. **ClaudeEngine** (for complex tasks) — Uses Claude API
   - Best reasoning for complex multi-step tasks
   - Vision capable
   - Invoke Claude Code CLI for coding tasks
3. **LocalEngine** (offline fallback) — Local LLM via Ollama
   - Privacy, no API costs
   - Works without internet

**Routing logic:** Simple commands → Gemini Live (fast). Complex reasoning → Claude. Offline → Local.

### Module 4: Action Engine
**Purpose:** Execute actions on the PC based on AI decisions.

**Components:**
- **System control** — Open apps, manage windows, control volume, etc.
  - `pyautogui` for keyboard/mouse
  - `subprocess` for launching apps
  - Windows COM automation for deep app control
- **Web browsing** — Search, open URLs, extract info
  - `playwright` for browser automation
  - Can show search results on HUD
- **File operations** — Read, create, organize files
- **Claude Code bridge** — Invoke Claude Code CLI for complex software tasks
  - `subprocess` call to `claude` CLI
  - Stream output back as HUD text or audio summary
- **Smart home** (future) — Home Assistant API, MQTT, etc.
- **Communication** — Send messages, emails (future)

**Tool/Function calling pattern:**
```python
TOOLS = {
    "open_app": {"fn": open_application, "desc": "Open an application by name"},
    "web_search": {"fn": web_search, "desc": "Search the web"},
    "read_screen": {"fn": capture_screen, "desc": "Take a screenshot of the PC"},
    "run_command": {"fn": run_shell_command, "desc": "Run a shell command"},
    "claude_code": {"fn": invoke_claude_code, "desc": "Ask Claude Code to do a complex task"},
    "set_reminder": {"fn": set_reminder, "desc": "Set a timed reminder"},
    "control_music": {"fn": control_music, "desc": "Play/pause/skip music"},
    # ... extensible
}
```

### Module 5: HUD Renderer
**Purpose:** Generate video frames showing the Jarvis UI on the glasses display.

**Technology:** `pygame` or `PIL/Pillow` for frame rendering → feed to virtual camera.

**HUD Elements (progressive):**
1. **MVP:** Black background + white text responses + simple status indicator
2. **V2:** Transparent-style overlay, notification cards, scrolling text
3. **V3:** Iron Man style — circular UI elements, scanning animations, data readouts

**Frame specs:**
- Resolution: Match WhatsApp video call resolution (likely 720p or 480p)
- FPS: 15-30fps (balance between smoothness and CPU)
- Format: RGB frames → virtual camera

**Display states:**
- **Idle:** Subtle "JARVIS ONLINE" indicator, time, battery
- **Listening:** Waveform or pulsing ring animation
- **Thinking:** Loading/processing animation
- **Responding:** Text + optional visual data
- **Action:** Shows what Jarvis is doing (e.g., "Opening Chrome...")

### Module 6: Orchestrator (Main Loop)
**Purpose:** Ties everything together. Event-driven main loop.

```
┌─────────┐     ┌───────┐     ┌────────┐     ┌──────────┐     ┌─────┐
│ Capture  │────►│ Audio │────►│   AI   │────►│  Action  │────►│ HUD │
│ Bridge   │     │ Pipe  │     │ Engine │     │  Engine  │     │ Rend│
└─────────┘     └───────┘     └────────┘     └──────────┘     └─────┘
     ▲                                                            │
     └────────────────────────────────────────────────────────────┘
                        (HUD frames → virtual cam)
```

---

## Tech Stack Summary

| Component | Technology | Why |
|-----------|-----------|-----|
| Language | Python 3.13 | Best ecosystem for AI/audio/vision |
| AI (Primary) | Gemini 2.0 Flash Live API | Native audio streaming, vision, fast |
| AI (Complex) | Claude API / Claude Code CLI | Best reasoning |
| STT/TTS | Gemini native (or Whisper + edge-tts) | Integrated with primary AI |
| Video capture | mss / dxcam | Fast screen capture on Windows |
| Audio capture | pyaudiowpatch / sounddevice | WASAPI loopback on Windows |
| Virtual camera | pyvirtualcam + OBS VCam | Mature, works with WhatsApp |
| Virtual audio | VB-Audio Virtual Cable | Industry standard on Windows |
| HUD rendering | Pillow + pygame | Simple, fast frame generation |
| PC automation | pyautogui + subprocess | Keyboard/mouse/app control |
| Web automation | playwright | Headless browser control |
| Async framework | asyncio | Everything is streaming/concurrent |

---

## Implementation Phases

### Phase 1: Foundation (The Bridge) 🎯 START HERE
**Goal:** Establish the WhatsApp video call as a working I/O channel.

- [ ] Install OBS Virtual Camera + VB-Audio Virtual Cable
- [ ] Write a script that renders test frames → virtual camera
- [ ] Confirm WhatsApp Desktop picks up virtual camera
- [ ] Capture incoming video from WhatsApp window (glasses camera)
- [ ] Capture incoming audio from WhatsApp (glasses mic)
- [ ] Route TTS audio through virtual mic → WhatsApp
- [ ] **Milestone:** You see test HUD on glasses, script captures your glasses camera feed

### Phase 2: Voice Loop
**Goal:** Speak to glasses → AI responds with voice on glasses.

- [ ] Integrate Gemini Live API (audio streaming)
- [ ] Pipe captured WhatsApp audio → Gemini Live
- [ ] Pipe Gemini Live audio response → virtual mic → WhatsApp → glasses speaker
- [ ] Add VAD so it knows when you're speaking vs ambient noise
- [ ] **Milestone:** "Jarvis, what time is it?" → hears answer on glasses

### Phase 3: Vision
**Goal:** AI can see what the glasses camera sees.

- [ ] Capture frames from WhatsApp incoming video at interval (e.g., every 2 sec)
- [ ] Send frames to Gemini vision (or Claude vision)
- [ ] AI can describe surroundings, read text, identify objects
- [ ] **Milestone:** "Jarvis, what am I looking at?" → accurate description

### Phase 4: HUD Display
**Goal:** Render useful information on the glasses display.

- [ ] Build HUD renderer with basic text display
- [ ] Show AI text responses on HUD
- [ ] Add status indicators (listening, thinking, responding)
- [ ] Show notifications, time, basic widgets
- [ ] **Milestone:** See AI responses as text on glasses while hearing them

### Phase 5: PC Control
**Goal:** Jarvis can take actions on your computer.

- [ ] Implement tool/function calling with Gemini
- [ ] Build action modules: app launch, web search, file ops
- [ ] Add Claude Code bridge for complex tasks
- [ ] Show action status on HUD
- [ ] **Milestone:** "Jarvis, open Chrome and search for..." → it happens

### Phase 6: Polish & Iron Man UI
**Goal:** Make it look and feel like the real thing.

- [ ] Design Iron Man-inspired HUD elements
- [ ] Add animations (scanning, data readouts, circular UI)
- [ ] Optimize latency across the entire pipeline
- [ ] Add wake word ("Jarvis")
- [ ] Add context awareness (time, location, calendar)
- [ ] Conversation memory / history

---

## Project Structure

```
JarvisGlasses/
├── jarvis/
│   ├── __init__.py
│   ├── main.py                 # Entry point & orchestrator
│   ├── config.py               # Configuration management
│   │
│   ├── bridge/                 # WhatsApp video call bridge
│   │   ├── __init__.py
│   │   ├── video_capture.py    # Capture glasses camera from WhatsApp
│   │   ├── audio_capture.py    # Capture glasses mic from WhatsApp
│   │   ├── virtual_camera.py   # HUD → virtual camera → WhatsApp
│   │   └── virtual_mic.py      # TTS → virtual mic → WhatsApp
│   │
│   ├── audio/                  # Audio processing pipeline
│   │   ├── __init__.py
│   │   ├── vad.py              # Voice activity detection
│   │   ├── stt.py              # Speech-to-text (fallback)
│   │   └── tts.py              # Text-to-speech (fallback)
│   │
│   ├── ai/                     # AI engine (pluggable)
│   │   ├── __init__.py
│   │   ├── base.py             # Abstract AI engine interface
│   │   ├── gemini_live.py      # Gemini Live implementation
│   │   ├── claude_engine.py    # Claude API implementation
│   │   └── local_engine.py     # Local LLM (Ollama)
│   │
│   ├── actions/                # PC control & tool execution
│   │   ├── __init__.py
│   │   ├── registry.py         # Tool registry & dispatcher
│   │   ├── system.py           # OS-level actions
│   │   ├── web.py              # Web browsing actions
│   │   ├── files.py            # File operations
│   │   └── claude_code.py      # Claude Code CLI bridge
│   │
│   ├── hud/                    # HUD rendering
│   │   ├── __init__.py
│   │   ├── renderer.py         # Main frame renderer
│   │   ├── elements.py         # UI elements (text, cards, widgets)
│   │   ├── animations.py       # Transition & status animations
│   │   └── themes/
│   │       ├── minimal.py      # MVP theme
│   │       └── ironman.py      # Iron Man theme
│   │
│   └── utils/
│       ├── __init__.py
│       └── logging.py
│
├── assets/                     # Fonts, images, sounds
│   ├── fonts/
│   └── sounds/
│
├── tests/
├── requirements.txt
├── .env.example                # API keys template
├── CLAUDE.md                   # Claude Code project context
└── PROJECT_PLAN.md             # This file
```

---

## Prerequisites to Install

### Software
1. **OBS Studio** — for OBS Virtual Camera driver
2. **VB-Audio Virtual Cable** — free virtual audio device
3. **WhatsApp Desktop** — Windows Store or installer
4. **Python packages** — see requirements.txt

### API Keys Needed
1. **Google AI Studio** — Gemini API key (free tier available)
2. **Anthropic** — Claude API key (for complex reasoning)

---

## Key Technical Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| WhatsApp video call quality/resolution too low | HUD text unreadable | Test early, optimize font sizes, use high-contrast colors |
| Audio feedback loop (speaker → mic on glasses) | Echo/feedback | Gemini Live has echo cancellation; add noise gate |
| WhatsApp rate-limits or blocks automation | Bridge breaks | We're not automating WhatsApp itself, just using virtual cam/mic — low risk |
| Gemini Live API latency spikes | Slow responses | Local fallback, response streaming |
| Virtual camera not recognized by WhatsApp | No display output | Test OBS VCam compatibility first (Phase 1 task) |

---

## Next Step

**Phase 1, Task 1:** Set up the virtual camera and confirm WhatsApp Desktop recognizes it. This validates the entire display concept before we write any AI code.
