# Persona MVP — Claude Code Build Instructions

> **Product:** Persona — Passive Ambient Health Intelligence for Meta Glasses  
> **Target:** Hackathon MVP (24-hour build scope)  
> **Demo Mode:** Browser-based fallback (webcam + mic simulate Meta glasses input). No physical glasses hardware required.  
> **Stack:** React frontend + TensorFlow.js models + Claude API (claude-sonnet-4-20250514)

---

## 0. Project Setup

```
persona-mvp/
├── public/
├── src/
│   ├── components/
│   │   ├── tabs/
│   │   │   ├── PeopleTab.jsx
│   │   │   ├── MetricsTab.jsx
│   │   │   └── MealsTab.jsx
│   │   ├── prompts/
│   │   │   └── PromptCard.jsx
│   │   └── shared/
│   ├── lib/
│   │   ├── session.js          # Session state machine
│   │   ├── camera.js           # Webcam frame capture
│   │   ├── audio.js            # Mic + Web Speech API
│   │   ├── models/
│   │   │   ├── sceneClassifier.js
│   │   │   ├── foodDetector.js
│   │   │   └── faceDetector.js
│   │   ├── claudeApi.js        # Claude API integration
│   │   └── storage.js          # IndexedDB persistence
│   ├── App.jsx
│   └── main.jsx
├── package.json
└── .env
```

Initialize:
```bash
npm create vite@latest persona-mvp -- --template react
cd persona-mvp
npm install @tensorflow/tfjs @tensorflow-models/mobilenet face-api.js localforage
```

---

## 1. Session State Machine

**File:** `src/lib/session.js`

Implement a session state machine with three states: `IDLE`, `RUNNING`, `STOPPED`.

- `startSession()` → sets state to `RUNNING`, starts the polling loop, starts audio monitoring
- `stopSession()` → sets state to `STOPPED`, flushes any in-progress interactions/meals to storage
- `pauseSession()` → sets state to `PAUSED`, suspends polling loop without flushing
- Expose a React context (`SessionContext`) so any component can read state and call controls
- Session start time and duration are tracked in state

The polling loop (interval configurable: 30 / 60 / 120 / 300 seconds, default 60s) fires `onPollFrame()` which:
1. Captures a webcam frame
2. Runs scene classification
3. Runs food detection
4. If food is detected, increments a food consecutive counter
5. Passes the frame to face detection

---

## 2. Camera Frame Capture

**File:** `src/lib/camera.js`

- `initCamera()` → requests `getUserMedia({ video: true })`, attaches stream to a hidden `<video>` element
- `captureFrame()` → draws one frame to an offscreen `<canvas>`, returns `ImageData` and a JPEG blob
- `stopCamera()` → stops all tracks
- Export a React hook `useCamera()` that surfaces `{ videoRef, captureFrame, cameraReady }`
- The video element should render in the demo UI so the user can see what the "glasses" see

---

## 3. Scene Classifier — Feature 2

**File:** `src/lib/models/sceneClassifier.js`

Use TensorFlow.js MobileNetV3 (load from `@tensorflow-models/mobilenet`) to classify each polled frame into one of three environment categories.

**Classification logic:**
- Run `model.classify(imageElement, 5)` to get top-5 predictions with scores
- Map raw ImageNet/MobileNet labels to Persona categories:
  - **OUTSIDE**: predictions containing keywords: `outdoor`, `sky`, `tree`, `park`, `street`, `grass`, `road`, `garden`, `beach`, `mountain`, `forest`
  - **SCREEN**: predictions containing: `screen`, `monitor`, `television`, `laptop`, `computer`, `display`, `phone`. Screen takes priority over INSIDE/OUTSIDE.
  - **INSIDE**: default when not OUTSIDE or SCREEN. Keywords: `room`, `office`, `kitchen`, `bedroom`, `living`, `wall`, `ceiling`, `indoor`
- If top prediction confidence < 0.60 → return `UNCERTAIN`
- Export `classifyScene(imageElement)` → returns `{ label: 'OUTSIDE'|'INSIDE'|'SCREEN'|'UNCERTAIN', confidence: number }`

**Time tracking:**
- Accumulate a `timeTotals` object: `{ OUTSIDE: 0, INSIDE: 0, SCREEN: 0 }` (in minutes)
- Each classified frame adds `pollIntervalMinutes` to the matching category
- Persist daily totals in IndexedDB, keyed by date string `YYYY-MM-DD`
- Compute 7-day rolling averages from stored daily totals
- Emit a `SCREEN_90MIN_WARNING` event when SCREEN accumulates ≥ 90 consecutive minutes

---

## 4. Food Detector — Feature 3

**File:** `src/lib/models/foodDetector.js`

**Step 1 — Food presence (binary detection):**
- Use MobileNet classify on the frame
- Check if any of top-5 predictions contains food keywords: `food`, `dish`, `meal`, `salad`, `pizza`, `burger`, `pasta`, `soup`, `fruit`, `vegetable`, `sandwich`, `rice`, `bread`, `dessert`, `coffee`, `drink`, `plate`, `bowl`
- If max food keyword confidence > 0.80 → `isFoodPresent = true`
- Export `detectFoodPresence(imageElement)` → returns `{ isFoodPresent: boolean, topLabels: string[], confidence: number }`

**Step 2 — Meal confirmation logic (in session.js polling loop):**
- Maintain a `foodConsecutiveCount` counter
- Increment on each frame where `isFoodPresent === true`, reset on false
- When `foodConsecutiveCount >= 3` → trigger meal confirmation flow (send to Claude API)
- Capture the frame at the peak confidence moment as the meal snapshot (store as base64 JPEG in state)
- Maintain `foodAbsentCount` after a meal start; when ≥ 5 consecutive absent frames → mark meal as ended

**Step 3 — Claude API nutritional estimation:**
Call `estimateMealNutrition(topLabels, portionSize, mealTime)` which sends:

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1000,
  "system": "You are a nutrition estimation assistant. Always respond with valid JSON only. No markdown, no preamble.",
  "messages": [{
    "role": "user",
    "content": "The user is eating a meal. Detected items: [FOOD_LABELS]. Estimated portion: [SIZE]. Meal time: [TIME]. Return a JSON object with exactly this shape: { \"meal_name\": string, \"items\": [{\"name\": string, \"quantity\": string, \"calories\": number, \"protein_g\": number, \"carbs_g\": number, \"fat_g\": number}], \"total_calories\": number, \"total_protein_g\": number, \"total_carbs_g\": number, \"total_fat_g\": number, \"confidence\": \"low\"|\"medium\"|\"high\" }"
  }]
}
```

Parse the response JSON and merge into a meal log entry object:
```js
{
  id: uuid,
  timestamp: ISO string,
  snapshotBase64: string,    // JPEG thumbnail
  mealName: string,
  items: [...],
  totalCalories: number,
  macros: { protein, carbs, fat },
  confidence: 'low'|'medium'|'high'
}
```

Persist meal log entries to IndexedDB.

---

## 5. Face Detector — Feature 1

**File:** `src/lib/models/faceDetector.js`

Use `face-api.js` for in-browser face detection and embedding.

**Setup:**
```js
import * as faceapi from 'face-api.js'
// Load models from /public/models/
await faceapi.nets.tinyFaceDetector.loadFromUri('/models')
await faceapi.nets.faceRecognitionNet.loadFromUri('/models')
await faceapi.nets.faceLandmark68Net.loadFromUri('/models')
```

Download face-api.js model weights and place in `public/models/`. Required models:
- `tiny_face_detector_model`
- `face_landmark_68_model`
- `face_recognition_model`

**Detection:**
- `detectFace(imageElement)` → runs `faceapi.detectSingleFace(imageElement, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor()`
- Returns `{ detected: boolean, descriptor: Float32Array (128-dim), box: { x, y, width, height } }`
- Crop the face region from the canvas as a JPEG thumbnail (base64)

**Person matching:**
- Maintain a `personStore` array in IndexedDB: `[{ id, name, descriptor: number[], thumbnailBase64, interactionCount }]`
- On each detected face: compute cosine similarity between descriptor and all stored descriptors
- If max similarity > 0.85 → match found → return existing person record
- If max similarity ≤ 0.85 → create new person record with name `Person N` (auto-increment N)
- `matchOrCreatePerson(descriptor, thumbnailBase64)` → returns `{ person, isNew: boolean }`

**Interaction detection logic (in polling loop):**
- Track `faceConsecutiveCount` and `speechActive` (from audio module)
- Interaction STARTS when: `faceConsecutiveCount >= 3 AND speechActive === true`
- Interaction ENDS when: face absent for 30+ consecutive seconds OR speech drops for 60+ seconds
- On interaction start → capture face snapshot → match person → trigger prompt card
- On interaction end → flush transcript + call Claude summary API → save to interaction store

---

## 6. Audio — Transcription & Speech Detection

**File:** `src/lib/audio.js`

**Speech Activity Detection:**
- Use `getUserMedia({ audio: true })` + `AudioContext` + `AnalyserNode` to monitor audio energy
- Sample energy every 500ms: if RMS > threshold (default 0.02) → `speechActive = true`
- Export `useSpeechActivity()` hook that returns `{ speechActive: boolean }`

**Transcription:**
- Use the browser's `SpeechRecognition` / `webkitSpeechRecognition` API (Web Speech API)
- `startTranscription()` → creates a recognition session with `continuous: true, interimResults: true`
- Accumulate `results` into a `transcript` string with speaker labels: `[Speaker A]: ...text...`
- `stopTranscription()` → finalizes and returns the full transcript string
- Export `useTranscription()` hook: `{ transcript, startTranscription, stopTranscription, isListening }`

**Claude API Interaction Summary:**
Call `summarizeInteraction(transcript)`:

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1000,
  "system": "You are a conversation summarization assistant. Always respond with valid JSON only. No markdown, no preamble.",
  "messages": [{
    "role": "user",
    "content": "Summarize this conversation transcript. Return JSON with exactly: { \"overview\": string (one sentence), \"key_topics\": string[], \"action_items\": string[], \"sentiment\": \"positive\"|\"neutral\"|\"tense\", \"duration_minutes\": number }. Transcript: [TRANSCRIPT]"
  }]
}
```

If transcript length < 10 words → skip the API call → store as `{ overview: "Brief interaction", key_topics: [], action_items: [], sentiment: "neutral" }`.

**Interaction log entry shape:**
```js
{
  id: uuid,
  personId: string,
  timestamp: ISO string,
  durationSeconds: number,
  transcript: string,
  summary: { overview, key_topics, action_items, sentiment },
  snapshotBase64: string
}
```

Persist to IndexedDB under `interactions` store.

---

## 7. Claude API Client

**File:** `src/lib/claudeApi.js`

```js
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-20250514'

export async function callClaude({ system, userMessage, maxTokens = 1000 }) {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }]
    })
  })
  const data = await response.json()
  const text = data.content?.find(b => b.type === 'text')?.text ?? ''
  // Strip any accidental markdown fences
  const clean = text.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}
```

Wire `summarizeInteraction` and `estimateMealNutrition` to call this.

Store the API key in `.env`:
```
VITE_ANTHROPIC_API_KEY=your_key_here
```

---

## 8. Storage (IndexedDB)

**File:** `src/lib/storage.js`

Use `localforage` as the IndexedDB wrapper. Define four logical stores (use key prefixes):

| Store | Key Pattern | Value |
|---|---|---|
| `persons` | `person:{id}` | Person record |
| `interactions` | `interaction:{id}` | Interaction record |
| `meals` | `meal:{YYYY-MM-DD}:{id}` | Meal record |
| `metrics` | `metrics:{YYYY-MM-DD}` | `{ OUTSIDE, INSIDE, SCREEN }` minutes |

Export helpers:
- `savePerson(person)`, `getPersons()`, `updatePerson(id, changes)`, `deletePerson(id)`
- `saveInteraction(interaction)`, `getInteractionsByPerson(personId)`
- `saveMeal(meal)`, `getMealsByDate(dateStr)`, `deleteMeal(id)`
- `updateDailyMetrics(dateStr, category, minutesToAdd)`, `getDailyMetrics(dateStr)`, `getLast7DaysMetrics()`

---

## 9. Prompt Card — Feature 4 (Mock Glasses Display)

**File:** `src/components/prompts/PromptCard.jsx`

Since the WhatsApp/ReplayKit mechanism is iOS-only, in the web demo simulate the glasses overlay as a **modal overlay** that appears full-screen over the companion UI.

**Props:**
```js
{
  trigger: 'INTERACTION_START' | 'INTERACTION_END' | 'NEW_PERSON' | 'MEAL_DETECTED' | 'LOW_CONFIDENCE_MEAL' | 'SCREEN_BREAK',
  contextData: { personName?, snapshotBase64?, mealName?, calories?, screenMinutes? },
  onPrimary: () => void,   // "Log" / "Save" / "Remind me"
  onDismiss: () => void,
  timeoutSeconds: 15
}
```

**Visual design:**
- Full-screen dark overlay with a centered card
- Card has: feature icon (top), context visual or emoji, bold primary question (max 10 words), two large buttons (primary = green, dismiss = gray), animated timeout progress bar along the bottom
- Auto-fires `onPrimary` (for most triggers) or `onDismiss` (for SCREEN_BREAK) after 15s timeout
- Animate countdown bar depleting from full width to zero over 15s using CSS animation

**Trigger → message mapping:**

| Trigger | Icon | Question | Primary Button | Dismiss Button | Default |
|---|---|---|---|---|---|
| `INTERACTION_START` | 👤 | "Log this conversation?" | Log | Skip | Log |
| `INTERACTION_END` | 💾 | "Save transcript and summary?" | Save | Discard | Save |
| `NEW_PERSON` | 🙋 | "New person. What's their name?" | Save as Person N | Skip | Save as Person N |
| `MEAL_DETECTED` | 🍽 | "Looks like a meal. Log it?" | Log | Skip | Log |
| `LOW_CONFIDENCE_MEAL` | 🤔 | "Can't identify meal clearly. Log anyway?" | Log | Skip | Log |
| `SCREEN_BREAK` | 🖥 | "You've been at a screen 90+ min. Take a break?" | Remind me | Dismiss | Dismiss |

---

## 10. Companion App UI

**File:** `src/App.jsx` and `src/components/tabs/`

Build a mobile-first single-page app with three bottom tabs. Overall layout:

```
┌─────────────────────────────┐
│  🔴 LIVE  |  Persona        │  ← Header with session status
│  [Camera preview strip]     │  ← 16:9 webcam feed, always visible
├─────────────────────────────┤
│                             │
│   [Tab content]             │
│                             │
├─────────────────────────────┤
│  👤 People  📊 Metrics  🍽 Meals │  ← Bottom nav
└─────────────────────────────┘
```

**Session control:**
- Top bar shows session status badge: gray IDLE / green RUNNING / red STOPPED
- "Start Day" button → calls `startSession()`, badge turns green
- "End Session" button (visible while RUNNING) → calls `stopSession()`

### Tab A — People (Feature 1)

- Grid of person cards: face thumbnail + name + "N interactions" count
- Tap a person → Person Detail View: chronological list of interaction entries
- Each interaction entry: face thumbnail, date/time, duration, LLM summary (overview + key topics chips + action items)
- Expandable full transcript per interaction
- Search bar: full-text search across all summaries and transcripts
- Long-press or edit button → rename person
- Swipe-to-delete interaction entries

### Tab B — Metrics (Feature 2)

**Today view:**
- Three horizontal bar segments for OUTSIDE / INSIDE / SCREEN, proportional to accumulated time
- Duration labels under each segment (e.g., "2h 14m Outside")
- Session coverage indicator if < 70% of poll intervals were classifiable (show "Low coverage — X% classified")
- User-configurable daily targets (e.g., "2h outside") with progress rings

**7-day chart:**
- Stacked bar chart or grouped line chart showing daily totals per category
- Use a lightweight charting library (`recharts`) or pure SVG

**Current frame label:**
- Live label showing what the current frame was classified as (updates every poll)

### Tab C — Meals (Feature 3)

**Today view:**
- Daily calorie total at the top with a user-set target progress bar (default target: 2000 kcal)
- Chronological list of logged meals: snapshot thumbnail + meal name + time + calorie total
- Tap a meal → Meal Detail View: food item breakdown table (name | qty | cal | P | C | F), confidence badge (low/medium/high), timestamp
- "Edit" button on detail view → allow editing meal name, calorie value, and macros manually
- Swipe-to-delete meals

**History:**
- 7-day calorie bar chart with average line

---

## 11. Consent & Disclosure (Required)

Before any recording begins, show a one-time onboarding consent screen with plain-language disclosure:

> "Persona will use your camera and microphone to automatically log conversations, track where you spend your time, and identify meals. Faces and voice of people you speak with may be captured. All processing happens on your device. Transcripts are sent (as text only) to an AI service for summarization."

The user must tap "I Agree & Continue" before `startSession()` is callable. Store consent timestamp in IndexedDB. If consent is not recorded, disable the Start Day button and show the consent screen instead.

Also:
- Display a persistent "🔴 Recording" indicator in the UI whenever a session is RUNNING
- Show calorie estimate disclaimer in the Meals tab: "Estimates are ±20–30% accurate. Not a clinical nutrition tool."
- Show transcript accuracy disclaimer in the People tab: "Other party's speech may be lower quality."

---

## 12. Environment Variables

Create `.env` at project root:
```
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

Add `.env` to `.gitignore`.

---

## 13. Build Order (Recommended Sequence)

1. **Project scaffold** — Vite + React setup, folder structure, routing, bottom nav shell
2. **Camera module** — `initCamera`, `captureFrame`, webcam preview in UI
3. **Session state machine** — context, `startSession`/`stopSession`, polling loop stub
4. **Storage layer** — localforage helpers for all four stores
5. **Scene classifier** — load MobileNet, map labels, accumulate metrics, Metrics tab displays live label
6. **Metrics tab** — today's time bars, 7-day chart, coverage indicator
7. **Food detector** — food presence binary check, consecutive counter, meal confirmation trigger
8. **Claude API client** — `callClaude`, error handling, JSON parsing
9. **Meal nutrition call** — `estimateMealNutrition`, save to storage, Meals tab list
10. **Meals tab** — today list, daily total bar, 7-day chart, meal detail view
11. **Face detector** — face-api.js model load, detection, embedding, person matching
12. **Audio module** — speech activity detection, Web Speech API transcription
13. **Interaction logic** — detection triggers, snapshot, person match, transcript capture
14. **Claude summary call** — `summarizeInteraction`, save interaction to storage
15. **People tab** — person grid, detail view, interaction list, search
16. **Prompt card** — overlay modal, all six trigger types, 15s countdown, auto-fire
17. **Wire prompt card** to all detection triggers across Features 1, 2, 3
18. **Consent screen** — onboarding gate, store consent flag
19. **Polish** — loading states for model initialization, error toasts, responsive layout, live session badge

---

## 14. Demo Checklist

Before presenting to judges, verify the following end-to-end flows work:

- [ ] Consent screen appears on first load; Start Day button is disabled until consent given
- [ ] Clicking "Start Day" starts the polling loop; green RUNNING badge appears
- [ ] Webcam feed is visible in the UI
- [ ] Pointing camera at a window → Metrics tab shows OUTSIDE accumulating; prompt says "OUTSIDE"
- [ ] Pointing camera at a monitor/phone screen → SCREEN label appears, time accumulates
- [ ] Holding a plate or food image in front of camera → food confirmed after 3 frames → Claude returns meal JSON → meal appears in Meals tab with calorie breakdown
- [ ] Speaking in front of the camera → face detected + speech active → interaction start prompt card appears → transcript accumulates → ending the interaction → Claude returns summary → entry appears in People tab under matched person
- [ ] Prompt card auto-fires default action after 15 seconds if not responded to
- [ ] Clicking "End Session" → session STOPPED → all data persists and is viewable in all three tabs

---

## 15. Notes for Claude Code

- Load TensorFlow.js models lazily on first session start (not at app init) to avoid blocking the UI
- Show a loading splash while models initialize: "Loading Persona intelligence models…"
- Handle Claude API errors gracefully: if API call fails, save the interaction/meal with a `claudeError: true` flag and show a retry button in the detail view
- face-api.js model weights must be downloaded separately and placed in `public/models/` — the model files are not bundled via npm. Download from the [face-api.js GitHub releases](https://github.com/justadudewhohacks/face-api.js/tree/master/weights).
- Use `requestAnimationFrame` for the prompt card countdown animation, not `setInterval`
- All timestamps should be stored as ISO strings and displayed in local time
- The polling loop should be implemented with `setTimeout` (re-scheduled after each poll completes) rather than `setInterval`, to avoid overlapping poll calls if a frame takes longer to process than the interval
