# HackPrinceton2026

Persona
Like an Oura Ring but for vision, logging metrics for your life. Persona is a memory layer for Meta glasses, saving faces, conversations, and experiences, so you always remember who you're meeting.
Inspiration
You meet hundreds of people a year at mixers, conferences, parties. Two weeks later you run into them again and have no idea who they are, let alone what you talked about. For the 2% of people with prosopagnosia, TBI survivors, and folks with early-stage dementia, that gap isn't awkward. It's daily life.
Existing tools like CrossSense answer "who is this?" We wanted to answer the harder question: "what did they tell you, and what should you ask about now?"
What it does
Persona is a memory layer for Meta smart glasses. Meet someone worth remembering, trigger enrollment, and Persona captures their face, transcribes the conversation, and builds a structured profile of who they are, what they care about, and what to follow up on.
Next time they walk up, Persona surfaces a quick primer: "This is Aisha, her sister's wedding was last month, ask how it went."
Opt-in, on-device, fully deletable. No cloud, no strangers, no dossiers.
How we built it
We forked Meta's CameraAccess sample from the Wearables Device Access Toolkit, which got us SDK setup, pairing, and the camera/audio hooks for free.
From there, four loops:
Enrollment: multi-angle face capture into ArcFace embeddings
Audio: 5-mic array into pyannote.audio diarization, then Whisper transcription
Extraction: transcript into an LLM with a structured schema (facts, topics, follow-ups, tone)
Recognition: face match against a local vector DB, profile surfaced in the companion app
Swift/SwiftUI on iOS, Python for the ML pipeline, everything stored locally on the paired phone.
Challenges
Noisy-room diarization. Separating the wearer's voice from the other person's in a loud hackathon venue took pre-enrolling our own voices.
Structured extraction without hallucination. Getting the LLM to pull real facts and not invent plausible-sounding ones took real prompt iteration.
Consent UX. Making the enrollment trigger feel natural in a live conversation, not creepy, not clunky, was as much a design problem as an engineering one.
Accomplishments
End-to-end working pipeline: face to conversation to profile to recall, all in 36 hours
Privacy-first architecture baked in from hour one
A demo where one of us "forgot" a teammate and Persona filled in the blanks
What we learned
Hardware SDKs shape what you can ship more than the models do. Privacy design is a feature, not a footnote. And the gap between recognizing a face and remembering a person is entirely in how well you extract and consolidate what was said.
What's next
Shared profiles between trusted contacts (your partner meets someone at a dinner, the profile syncs to you). A "birthday and milestones" layer that surfaces the right follow-up at the right time. And eventually, a version for Android glasses and Apple's rumored smart frames so Persona isn't locked to one ecosystem.
Built With
computervision
gemini
metaapi
ml
react
swift

