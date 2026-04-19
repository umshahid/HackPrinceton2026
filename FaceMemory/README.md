# Face Memory

An iOS app that helps you remember people you've met. Point the Meta AI glasses (or your phone's camera) at someone you know, and the app recognizes them and surfaces what you know about them. Someone new? Enroll them with a tap and have Gemini generate a written description plus summarize the conversation you just had.

## What works out of the box

The project compiles and runs immediately after you clone it. Before you add the Meta Wearables SDK, the **Live** tab uses your phone's front camera as a stand-in so you can develop and test face detection, enrollment, Gemini descriptions, and encounter logging without the glasses.

Once you add the Meta Wearables SDK via Swift Package Manager, the code **automatically switches** to using the glasses camera on the next build. No code changes required — `#if canImport` guards handle the swap.

## Setup

### 1. Open the project

```bash
cd FaceMemory
open FaceMemory.xcodeproj
```

### 2. Set your signing team

Select the project → `FaceMemory` target → **Signing & Capabilities** → set your **Team** to your Apple ID. Change the bundle ID to something unique under your account (e.g. `com.anthonylastname.facememory`).

### 3. Paste your Gemini API key

Open `FaceMemory/Resources/Info.plist` and replace the `GEMINI_API_KEY` value with your key from [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).

### 4. First build — verify it runs on your phone

Plug in iPhone → trust the computer → select device in the Xcode toolbar → ⌘R. The app launches using the **front-facing phone camera** as a mock feed. Tap **Start** on the Live tab, point your phone at yourself, try the enrollment flow. Once this works, you know signing, the API key, and the recognition pipeline are all set up correctly.

First launch on the phone: **Settings → General → VPN & Device Management → [your Apple ID] → Trust**, then run again.

### 5. Add the Meta Wearables SDK

This is the step that switches the app from phone camera to glasses camera.

1. In Xcode: **File → Add Package Dependencies…**
2. Paste: `https://github.com/facebook/meta-wearables-dat-ios`
3. Pick the latest version, click **Add Package**
4. When the product dialog appears, add **MWDATCore** and **MWDATCamera** to the `FaceMemory` target. `MWDATMockDevice` is optional — add it if you want to test streaming without real glasses.
5. Build again (⌘B). The `#if canImport(MWDATCamera)` guards in `GlassesStreamManager.swift` and `FaceMemoryApp.swift` now light up. The mock camera code is stripped out at compile time.

### 6. Register your bundle ID with Meta

Registration with the Meta AI app won't work unless your bundle ID is recognized by Meta's servers:

1. Go to [wearables.developer.meta.com](https://wearables.developer.meta.com)
2. Open (or create) your project
3. Under **Release Channels**, add your app's bundle ID — the exact string from Signing & Capabilities
4. Add your Meta account email as a test user on that channel

### 7. Enable Developer Mode in the Meta AI app

On your phone, open the Meta AI app → **Settings → App Info → tap the App version number 5 times**. Toggle Developer Mode on.

### 8. Register and stream

1. Build and run Face Memory (⌘R)
2. Go to the **Settings tab** → tap **Register with Meta AI app**
3. You'll bounce over to Meta AI → approve → bounce back to Face Memory
4. Return to the **Live tab** → tap **Start**
5. Stream status should go *Connecting → Starting → Streaming*

## Troubleshooting

**"No such module 'MWDATCore'" during build**
The package didn't finish resolving. File → Packages → Reset Package Caches, then File → Packages → Resolve Package Versions.

**Settings tab shows "Not registered" after tapping Register**
Meta AI app didn't bounce back successfully. Almost always a URL scheme mismatch — check Xcode's console for what URL came in (there's a print statement in `handleMetaCallback`). If the URL scheme Meta is sending doesn't match what's in your `CFBundleURLTypes`, copy Meta's `CameraAccess` sample Info.plist URL scheme pattern exactly and swap in your bundle ID.

**Registration succeeds, streaming never starts**
Three things to check, in order: (a) glasses are paired in the Meta AI app, (b) Developer Mode is on in Meta AI, (c) your bundle ID is listed in a release channel in the Wearables Developer Center.

**Streaming starts but no frames appear**
Open the Meta AI app and confirm the glasses show "Connected." Glasses on, charged, and within Bluetooth Classic range.

**Build succeeds but app still uses phone camera**
The canImport guard didn't see the package. In Xcode, click the project → target → **General** → scroll to **Frameworks, Libraries, and Embedded Content**. Confirm `MWDATCore` and `MWDATCamera` are listed. If not, add them from the + button.

**"Untrusted Developer" on phone launch**
Settings → General → VPN & Device Management → [your Apple ID] → Trust.

## Architecture

```
┌───────────────────────────┐     ┌──────────────────────┐
│  Meta Glasses (or camera) │────▶│  GlassesStreamManager │
└───────────────────────────┘     └──────────┬───────────┘
                                             │ latestFrame
                                             ▼
                                  ┌──────────────────────┐
                                  │ RecognitionCoordinator│
                                  └──┬───────────────────┘
                      detects + embeds│     matches against
                                      ▼
                     ┌──────────────────────────┐
                     │  FaceRecognitionService  │  (Vision framework, on-device)
                     └──────────┬───────────────┘
                                │
                  not found     │    found
              ┌─────────────────┴────────────────┐
              ▼                                  ▼
    ┌──────────────────┐               ┌──────────────────┐
    │ EnrollmentSheet  │               │  Match card      │
    └────────┬─────────┘               └────────┬─────────┘
             ▼                                  ▼
    ┌──────────────────┐               ┌──────────────────┐
    │  Gemini Vision   │               │  PersonDetailView │
    │  (describe face) │               │  + encounters    │
    └────────┬─────────┘               └──────────────────┘
             ▼
    ┌──────────────────┐
    │  SwiftData store │
    │  Person+Encounter│
    └──────────────────┘
```

**Key design choices:**

- On-device face detection via Apple's Vision framework. No images leave the device for recognition.
- Gemini 2.5 Flash is only called on explicit enrollment (for a written description) or after an encounter ends (to summarize the transcript). Saves cost, preserves privacy.
- SwiftData for local storage. Face embeddings serialized as `Data`, cosine similarity matching in memory.
- Stability checks: require 2 consecutive frames matching the same person before surfacing a "matched" card, 5-second cooldown after any event.
- `#if canImport` guards: the app runs without the Meta SDK (using the phone's front camera), and switches to glasses streaming automatically once the SDK is added.

## Project Structure

```
FaceMemory/
├── FaceMemoryApp.swift          App entry, SwiftData container, URL callback
├── Models/
│   └── Models.swift             Person + Encounter SwiftData models
├── Services/
│   ├── FaceRecognitionService   Vision detection, embedding, matching
│   ├── GeminiService            Gemini vision + conversation summary
│   ├── TranscriptionService     Speech-to-text with rolling buffer
│   ├── GlassesStreamManager     SDK wrapper + mock-camera fallback
│   └── RecognitionCoordinator   Orchestrator
├── Views/
│   ├── RootView                 Tab bar
│   ├── LiveView                 Live recognition surface
│   ├── EnrollmentSheet          Name + consent + save
│   ├── PeopleViews              List + detail
│   └── SettingsView             SDK status, API key, permissions
└── Resources/
    └── Info.plist
```

## Usage

1. **Live tab**: tap **Start** to begin streaming. Tap **Listen** to start transcription.
2. When a face is detected:
   - Known person → a match card pops up with the name. Tap to open their profile.
   - Unknown person → an "Unknown person" card with an **Enroll** button.
3. **Enrollment sheet**: enter the person's name, optional notes, tick the consent box (required), tap **Save**. Behind the scenes: Vision generates an embedding, Gemini writes a 2-3 sentence appearance description, everything gets saved to SwiftData.
4. **People tab**: list of everyone enrolled, sorted by last seen. Tap to view details + encounter history. Swipe to delete.
5. **Settings**: check SDK status, API key config, and permission grants.

## Privacy and legal notes

**Read this before you enroll anyone other than yourself.**

- Face recognition of people who haven't consented is illegal under Illinois BIPA, Texas CUBI, Washington, and GDPR, with per-person statutory damages in some jurisdictions. The enrollment sheet has a mandatory consent toggle for this reason — don't circumvent it.
- This app stores everything locally; no face data is uploaded. But the enrollment flow sends a single photo to Google's Gemini API to generate the appearance description. That image is subject to Google's [Gemini API terms](https://ai.google.dev/gemini-api/terms) and data-use policies. Note: the free AI Studio tier uses requests for product improvement by default. Use a paid key through a billed Google Cloud project for stricter data-use terms, or disable the `describePerson` call in `RecognitionCoordinator.enroll`.
- Meta's SDK is in developer preview and the glasses-captured imagery is subject to Meta's developer terms — read them before building anything that derives biometric identifiers from glasses video.
- This app cannot be shipped to the App Store while the Wearables SDK uses the ExternalAccessory framework (MFi program restrictions). Sideload-only until Meta resolves that.

## Recognition accuracy

The embedding is derived from Vision landmark points, which works for proof-of-concept but isn't as robust as a dedicated face model. For production-grade accuracy:

1. Convert MobileFaceNet or FaceNet to CoreML (search GitHub for `FaceNet-mlmodel`)
2. Add the `.mlmodel` file to the Xcode project
3. Replace `embeddingFromObservation` in `FaceRecognitionService` with a model inference that outputs a 128-dim or 512-dim embedding
4. Keep the cosine similarity matching. Only the embedding step changes.

Tune `matchThreshold` (currently 0.85) based on your model. FaceNet typically uses 0.6-0.7 cosine.

## Things that will bite you

- Low frame quality from Ray-Ban Meta's Bluetooth Classic stream. For enrollment, prefer the SDK's photo-capture path over a video frame.
- Main-actor discipline. Frame callbacks aren't main-actor; UI updates need explicit `Task { @MainActor in ... }`.
- Free Apple ID re-sign every 7 days. Budget for a developer account or schedule re-signs.
- Developer Mode on the Meta AI app must stay on or registration breaks.
- API key in Info.plist is visible in the built `.app` bundle. Fine for your phone only; don't distribute the build.

## License

Personal project. Do what you want with it.
