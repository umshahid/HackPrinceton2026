//
//  TranscriptionService.swift
//  FaceMemory
//
//  Uses Apple's Speech framework to transcribe audio from the phone's
//  microphone in real time. We keep the last N seconds of transcript
//  in a rolling buffer so when the user enrolls someone, we can attach
//  whatever conversation just happened.
//

import Foundation
import Speech
import AVFoundation

@MainActor
final class TranscriptionService: ObservableObject {

    static let shared = TranscriptionService()

    @Published private(set) var currentTranscript: String = ""
    @Published private(set) var isTranscribing: Bool = false
    @Published private(set) var authorizationStatus: SFSpeechRecognizerAuthorizationStatus = .notDetermined

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()

    // Rolling transcript buffer
    private var transcriptHistory: [(Date, String)] = []

    // MARK: - Permissions

    func requestAuthorization() async {
        let status = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0) }
        }
        await MainActor.run { self.authorizationStatus = status }

        // Also request mic permission
        await AVAudioApplication.requestRecordPermission()
    }

    // MARK: - Transcription Control

    func startTranscribing() throws {
        guard !isTranscribing else { return }
        guard authorizationStatus == .authorized else {
            throw NSError(domain: "Transcription", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Speech recognition not authorized"])
        }
        guard let recognizer = recognizer, recognizer.isAvailable else {
            throw NSError(domain: "Transcription", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Speech recognizer unavailable"])
        }

        // Cancel anything in flight
        recognitionTask?.cancel()
        recognitionTask = nil

        // Audio session
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        // Request
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = false
        self.recognitionRequest = request

        // Tap the input node
        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        audioEngine.prepare()
        try audioEngine.start()

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }

            if let result = result {
                let text = result.bestTranscription.formattedString
                Task { @MainActor in
                    self.currentTranscript = text
                    self.transcriptHistory.append((Date(), text))
                    // Keep last 5 minutes of history
                    let cutoff = Date().addingTimeInterval(-300)
                    self.transcriptHistory.removeAll { $0.0 < cutoff }
                }
            }

            if error != nil || (result?.isFinal ?? false) {
                Task { @MainActor in self.teardown() }
            }
        }

        isTranscribing = true
    }

    func stopTranscribing() {
        teardown()
    }

    private func teardown() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask = nil
        isTranscribing = false
    }

    // MARK: - Buffer Access

    /// Return the transcript from the last `seconds` before now.
    func recentTranscript(seconds: TimeInterval = 120) -> String {
        let cutoff = Date().addingTimeInterval(-seconds)
        let recent = transcriptHistory.filter { $0.0 >= cutoff }
        return recent.last?.1 ?? currentTranscript
    }

    func clearHistory() {
        transcriptHistory.removeAll()
        currentTranscript = ""
    }
}
