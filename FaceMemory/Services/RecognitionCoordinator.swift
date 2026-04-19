//
//  RecognitionCoordinator.swift
//  FaceMemory
//
//  Top-level orchestrator. Watches the frame stream, runs face detection
//  and embedding on each throttled frame, matches against the stored
//  people in SwiftData, and publishes a recognition state that the UI
//  consumes to show "matched" or "stranger" cards.
//

import Foundation
import SwiftData
import UIKit
import Combine

enum RecognitionState: Equatable {
    case idle
    case scanning
    case noFace
    case matched(personID: UUID, similarity: Float, name: String)
    case stranger(capturedImage: UIImage)
}

@MainActor
final class RecognitionCoordinator: ObservableObject {

    @Published var state: RecognitionState = .idle
    @Published var isActive: Bool = false

    private var modelContext: ModelContext?
    private var cancellables: Set<AnyCancellable> = []

    // Stability: require N consecutive matches to the same person before
    // surfacing a "matched" card, to reduce flicker.
    private var matchCandidate: (id: UUID, count: Int)?
    private let requiredConsecutiveMatches = 2

    // Cooldown: after a recognition event, wait before re-emitting
    private var lastEventTime: Date = .distantPast
    private let cooldownSeconds: TimeInterval = 5.0

    func attach(modelContext: ModelContext, stream: GlassesStreamManager) {
        self.modelContext = modelContext

        stream.$latestFrame
            .compactMap { $0 }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] frame in
                Task { await self?.process(frame: frame) }
            }
            .store(in: &cancellables)
    }

    func start() {
        isActive = true
        state = .scanning
    }

    func stop() {
        isActive = false
        state = .idle
        matchCandidate = nil
    }

    private func process(frame image: UIImage) async {
        guard isActive else { return }
        guard Date().timeIntervalSince(lastEventTime) > cooldownSeconds else { return }
        guard let cg = image.cgImage else { return }
        guard let ctx = modelContext else { return }

        do {
            let faces = try await FaceRecognitionService.shared.detectFaces(in: cg)
            guard !faces.isEmpty else {
                // Don't thrash the UI — only publish "noFace" if we were matched
                if case .matched = state { state = .scanning }
                return
            }

            let embedding = try await FaceRecognitionService.shared.generateEmbedding(from: cg)

            // Load all people from storage (fine for <10k people)
            let descriptor = FetchDescriptor<Person>()
            let people = try ctx.fetch(descriptor)

            if let match = FaceRecognitionService.shared.findMatch(query: embedding, among: people) {
                // Stability check
                if matchCandidate?.id == match.person.id {
                    matchCandidate?.count += 1
                } else {
                    matchCandidate = (match.person.id, 1)
                }

                if let candidate = matchCandidate,
                   candidate.count >= requiredConsecutiveMatches {
                    state = .matched(
                        personID: match.person.id,
                        similarity: match.similarity,
                        name: match.person.name
                    )
                    match.person.lastSeenDate = Date()
                    try? ctx.save()
                    lastEventTime = Date()
                    matchCandidate = nil
                }
            } else {
                matchCandidate = nil
                state = .stranger(capturedImage: image)
                lastEventTime = Date()
            }
        } catch FaceRecognitionError.lowQualityFace {
            // silently ignore
        } catch {
            print("[RecognitionCoordinator] process error: \(error)")
        }
    }

    /// Enroll a new person from a captured frame. Returns the new Person.
    func enroll(name: String, image: UIImage, notes: String = "") async throws -> Person {
        guard let ctx = modelContext else {
            throw NSError(domain: "Enrollment", code: 1)
        }
        guard let cg = image.cgImage else {
            throw NSError(domain: "Enrollment", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Bad image"])
        }

        let embedding = try await FaceRecognitionService.shared.generateEmbedding(from: cg)

        // Optional: get a VLM description
        var visualDescription = ""
        do {
            visualDescription = try await GeminiService.shared.describePerson(image: image)
        } catch {
            print("[Enrollment] VLM description failed: \(error)")
        }

        let thumbnail = image.jpegData(compressionQuality: 0.7)
        let person = Person(
            name: name,
            faceEmbedding: embedding,
            visualDescription: visualDescription,
            notes: notes,
            photoData: thumbnail
        )
        ctx.insert(person)
        try ctx.save()

        // Kick off a reset so we can recognize them immediately after enrollment
        state = .scanning
        matchCandidate = nil
        lastEventTime = Date()

        return person
    }

    /// Log an encounter for an already-recognized person. Transcribes
    /// recent audio and summarizes it via Claude.
    func logEncounter(for personID: UUID, transcript: String) async throws {
        guard let ctx = modelContext else { return }
        let id = personID
        let descriptor = FetchDescriptor<Person>(predicate: #Predicate { $0.id == id })
        guard let person = try ctx.fetch(descriptor).first else { return }

        var summary = ""
        var topics: [String] = []
        if !transcript.trimmingCharacters(in: .whitespaces).isEmpty {
            do {
                let result = try await GeminiService.shared.summarizeConversation(
                    transcript: transcript,
                    personName: person.name
                )
                summary = result.summary
                topics = result.keyTopics
            } catch {
                print("[Encounter] summary failed: \(error)")
                summary = transcript    // fall back to raw transcript
            }
        }

        let encounter = Encounter(
            conversationSummary: summary,
            keyTopics: topics,
            person: person
        )
        ctx.insert(encounter)
        person.lastSeenDate = Date()
        try ctx.save()
    }
}
