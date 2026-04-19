# Persona — Passive Ambient Health Intelligence

Browser-based demo simulating Meta glasses input via webcam + mic. Tracks conversations, environment time, and meals automatically using on-device ML and Gemini API.

## Quick Start

```bash
cd persona-mvp
npm install
```

Add your Gemini API key to `.env`:

```
VITE_GEMINI_API_KEY=your_key_here
```

Run the dev server:

```bash
npm run dev
```

Open `http://localhost:5173` in Chrome (required for Web Speech API). Accept the privacy consent, then click **Start Day** to begin a session.

## How It Works

**Session loop** — Once started, the app polls the webcam at a configurable interval (default 1s). Each poll runs three ML pipelines in sequence:

1. **Scene Classification** — MobileNet classifies each frame as Outside, Inside, or Screen. Time accumulates per category and persists daily. A warning fires after 90+ consecutive screen minutes.

2. **Food Detection** — MobileNet scans for food-related objects. Three consecutive food frames trigger a meal log. Gemini estimates calories and macros (protein/carbs/fat) from the detected labels.

3. **Face Detection** — face-api.js detects faces and generates 128-dimensional embeddings. Faces are matched against known persons via cosine similarity (threshold 0.85). New faces auto-create a person entry.

**Interactions** — When a face is detected for 3+ consecutive frames AND speech is active (via mic RMS monitoring), a conversation interaction starts. The Web Speech API transcribes audio in real-time. When the face/speech drops, Gemini summarizes the transcript into key topics, action items, and sentiment.

**Prompt Cards** — Glasses-style overlay prompts appear for key events (meal detected, new person, screen break, etc.) with a 15-second auto-dismiss countdown.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React + Vite |
| Scene/Food ML | TensorFlow.js MobileNet v2 |
| Face ML | face-api.js (TinyFaceDetector + FaceRecognitionNet) |
| Audio | Web Speech API + AudioContext RMS |
| AI Summaries | Gemini 2.0 Flash |
| Storage | IndexedDB via localforage |
| Charts | Recharts |

## Connecting the iPhone App (Glasses Camera)

The app receives camera frames from an external source (e.g. an iPhone running the Meta Ray-Ban glasses camera stream) via WebSocket instead of the browser webcam.

### 1. Start the frame server

In a separate terminal:

```bash
npm run frame-server
```

This starts a WebSocket server on `0.0.0.0:3001`.

### 2. Start the frontend dev server

```bash
npm run dev
```

Open `http://localhost:5173` in Chrome as usual.

### 3. Find your Mac's local IP

```bash
# macOS
ipconfig getifaddr en0
```

### 4. Configure the iPhone app

Point the iPhone app's WebSocket output to:

```
ws://<mac-ip>:3001/ingest
```

The iPhone should send raw JPEG bytes as binary WebSocket messages. Each message = one frame.

### 5. Test without the iPhone

You can simulate frame input from the Mac using `wscat`:

```bash
# Install wscat if needed
npx wscat -c ws://localhost:3001/ingest --binary < /path/to/test.jpg
```

Or send a frame with a one-liner:

```bash
# Grab a test JPEG (any image works)
curl -s -o /tmp/test.jpg https://picsum.photos/640/480

# Send it (requires wscat)
npx wscat -c ws://localhost:3001/ingest -x "$(cat /tmp/test.jpg)" --binary
```

The frame should appear in the browser preview within a second.

### WebSocket endpoints

| Path | Direction | Purpose |
|------|-----------|---------|
| `/ingest` | iPhone → Server | Push JPEG frames (binary) |
| `/stream` | Server → Frontend | Subscribe to frame stream |
| `/latest-frame` | HTTP GET | Fetch latest JPEG (for debugging) |

## Tabs

- **People** — Grid of recognized persons. Tap for interaction history with AI summaries, topic chips, action items, and full transcripts.
- **Metrics** — Today's Outside/Inside/Screen time bars, daily targets, live scene badge, and 7-day stacked chart.
- **Meals** — Daily calorie tracker with progress bar, meal list with nutrition breakdowns, confidence badges, and 7-day chart.
