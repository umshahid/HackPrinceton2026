//
//  RecognitionCoordinator.swift
//  FaceMemory
//
//  Top-level orchestrator. Watches the frame stream, runs face detection
//  and embedding on each throttled frame, matches against the stored
//  people in SwiftData, and publishes a recognition state that the UI
//  consumes to show "matched" or "stranger" cards.
//
//  Performance optimizations:
//    - Model warmup at attach-time so first real inference is fast
//    - People fetch cached, invalidated on enrollment/deletion
//    - High-confidence matches fire immediately (no 2-frame wait)
//    - Low-confidence matches still require stability check
//
//  Accuracy optimizations:
//    - Multi-frame enrollment captures 5 frames over ~1.5 seconds
//    - Enrollment requires higher quality than runtime matching
//    - Match score is max across all of a person's stored embeddings
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

enum EnrollmentError: LocalizedError {
    case noContext
    case badImage
    case lowQualityCapture(observed: Float, required: Float)
    case noFramesCaptured

    var errorDescription: String? {
        switch self {
        case .noContext: return "Storage not available"
        case .badImage: return "Image could not be processed"
        case .lowQualityCapture(let obs, let req):
            return String(format: "Face capture quality too low (%.2f < %.2f). Try better lighting or hold the glasses steadier.", obs, req)
        case .noFramesCaptured:
            return "Could not capture enough usable frames. Please try again and hold still."
        }
    }
}

@MainActor
final class RecognitionCoordinator: ObservableObject {

    @Published var state: RecognitionState = .idle
    @Published var isActive: Bool = false

    private var modelContext: ModelContext?
    private var cancellables: Set<AnyCancellable> = []

    // Stability: low-confidence matches require N consecutive hits.
    // High-confidence matches fire on the first frame.
    private var matchCandidate: (id: UUID, count: Int)?
    private let requiredConsecutiveMatches = 2
    private let highConfidenceThreshold: Float = 0.50

    // Cooldown: after a recognition event, wait before re-emitting.
    private var lastEventTime: Date = .distantPast
    private let cooldownSeconds: TimeInterval = 5.0

    // Cached people fetch. Invalidated on enroll/delete. Matching at 4Hz
    // against SwiftData would otherwise hit the store continuously.
    private var cachedPeople: [Person] = []
    private var peopleCacheValid: Bool = false

    func attach(modelContext: ModelContext, stream: GlassesStreamManager) {
        self.modelContext = modelContext

        // Warm the model so the first real frame doesn't pay compilation cost.
        Task.detached(priority: .utility) {
            FaceRecognitionService.shared.warmUp()
        }

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

    /// Force the people cache to refresh on next fetch. Call after
    /// enrollment, deletion, or any mutation of Person records.
    func invalidatePeopleCache() {
        peopleCacheValid = false
    }

    private func getPeople(from ctx: ModelContext) -> [Person] {
        if !peopleCacheValid {
            let descriptor = FetchDescriptor<Person>()
            cachedPeople = (try? ctx.fetch(descriptor)) ?? []
            peopleCacheValid = true
        }
        return cachedPeople
    }

    // MARK: - Frame Processing

    private func process(frame image: UIImage) async {
        guard isActive else { return }
        guard Date().timeIntervalSince(lastEventTime) > cooldownSeconds else { return }
        guard let cg = image.cgImage else { return }
        guard let ctx = modelContext else { return }

        do {
            let faces = try await FaceRecognitionService.shared.detectFaces(in: cg)
            guard !faces.isEmpty else {
                if case .matched = state { state = .scanning }
                return
            }

            let embedding = try await FaceRecognitionService.shared.generateEmbedding(from: cg)
            let people = getPeople(from: ctx)

            if let match = FaceRecognitionService.shared.findMatch(query: embedding, among: people) {
                // Diagnostic: log all scores so you can tune the threshold.
                // Comment out once you've dialed the threshold in.
                logAllScores(query: embedding, people: people, match: match)

                if match.similarity >= highConfidenceThreshold {
                    // High confidence: fire immediately, skip stability check.
                    fireMatch(person: match.person, similarity: match.similarity, ctx: ctx)
                } else {
                    // Low confidence: require 2 consecutive matches to the same person.
                    if matchCandidate?.id == match.person.id {
                        matchCandidate?.count += 1
                    } else {
                        matchCandidate = (match.person.id, 1)
                    }

                    if let candidate = matchCandidate,
                       candidate.count >= requiredConsecutiveMatches {
                        fireMatch(person: match.person, similarity: match.similarity, ctx: ctx)
                    }
                }
            } else {
                matchCandidate = nil
                state = .stranger(capturedImage: image)
                lastEventTime = Date()
            }
        } catch FaceRecognitionError.lowQualityFace {
            // Silently ignore — next frame will probably be better.
        } catch {
            print("[RecognitionCoordinator] process error: \(error)")
        }
    }

    private func fireMatch(person: Person, similarity: Float, ctx: ModelContext) {
        state = .matched(
            personID: person.id,
            similarity: similarity,
            name: person.name
        )
        person.lastSeenDate = Date()
        try? ctx.save()
        lastEventTime = Date()
        matchCandidate = nil
    }

    /// Diagnostic: prints the top-3 candidate similarities for a frame.
    /// Useful for threshold tuning against real glasses footage.
    private func logAllScores(query: [Float], people: [Person], match: (person: Person, similarity: Float)) {
        let service = FaceRecognitionService.shared
        let scores: [(String, Float)] = people.compactMap { person in
            var best: Float = -2
            for emb in person.faceEmbeddings {
                guard emb.count == query.count else { continue }
                let s = service.cosineSimilarityPublic(query, emb)
                if s > best { best = s }
            }
            return best > -1 ? (person.name, best) : nil
        }.sorted { $0.1 > $1.1 }

        let top = scores.prefix(3)
            .map { "\($0.0)=\(String(format: "%.3f", $0.1))" }
            .joined(separator: " | ")
        print("[AdaFace] matched=\(match.person.name) sim=\(String(format: "%.3f", match.similarity)) | top3: \(top)")
    }

    // MARK: - Enrollment

    /// Single-frame enrollment. Kept for backward compatibility but
    /// multi-frame enrollment (enroll(name:images:notes:)) is strongly
    /// preferred — it produces noticeably better runtime accuracy.
    func enroll(name: String, image: UIImage, notes: String = "") async throws -> Person {
        try await enroll(name: name, images: [image], notes: notes)
    }

    /// Multi-frame enrollment. Pass 3-5 frames captured over ~1-2 seconds
    /// showing slightly different angles/expressions. Each usable frame
    /// contributes one embedding; at match time we take the max
    /// similarity across all of them.
    ///
    /// Throws EnrollmentError.noFramesCaptured if all frames fail quality
    /// gating. The caller should surface this to the user and retry.
    func enroll(name: String, images: [UIImage], notes: String = "") async throws -> Person {
        guard let ctx = modelContext else { throw EnrollmentError.noContext }

        var embeddings: [[Float]] = []
        var firstThumbnail: Data? = nil
        var firstValidImage: UIImage? = nil

        for image in images {
            guard let cg = image.cgImage else { continue }

            do {
                let embedding = try await FaceRecognitionService.shared.generateEmbedding(
                    from: cg,
                    minQuality: FaceRecognitionService.minEnrollmentQuality
                )
                embeddings.append(embedding)
                if firstThumbnail == nil {
                    firstThumbnail = image.jpegData(compressionQuality: 0.7)
                    firstValidImage = image
                }
            } catch FaceRecognitionError.lowQualityFace {
                continue  // skip low-quality frames silently
            } catch FaceRecognitionError.noFaceFound {
                continue
            } catch {
                print("[Enrollment] frame failed: \(error)")
                continue
            }
        }

        guard !embeddings.isEmpty else {
            throw EnrollmentError.noFramesCaptured
        }

        // Optional: get a VLM description from the first valid frame.
        var visualDescription = ""
        if let firstValidImage = firstValidImage {
            do {
                visualDescription = try await GeminiService.shared.describePerson(image: firstValidImage)
            } catch {
                print("[Enrollment] VLM description failed: \(error)")
            }
        }

        let person = Person(
            name: name,
            faceEmbeddings: embeddings,
            visualDescription: visualDescription,
            notes: notes,
            photoData: firstThumbnail
        )
        ctx.insert(person)
        try ctx.save()

        print("[Enrollment] Enrolled \(name) with \(embeddings.count) embeddings")

        // Reset recognition so we can match them immediately after enrollment.
        invalidatePeopleCache()
        state = .scanning
        matchCandidate = nil
        lastEventTime = Date()

        return person
    }

    /// Add additional reference embeddings to an existing person. Useful
    /// when the user confirms a borderline match — we can opportunistically
    /// improve future accuracy for that person.
    func augmentPerson(id: UUID, withImage image: UIImage) async throws {
        guard let ctx = modelContext else { throw EnrollmentError.noContext }
        guard let cg = image.cgImage else { throw EnrollmentError.badImage }

        let descriptor = FetchDescriptor<Person>(predicate: #Predicate { $0.id == id })
        guard let person = try ctx.fetch(descriptor).first else { return }

        let embedding = try await FaceRecognitionService.shared.generateEmbedding(
            from: cg,
            minQuality: FaceRecognitionService.minEnrollmentQuality
        )

        var existing = person.faceEmbeddings
        existing.append(embedding)
        person.faceEmbeddings = existing

        try ctx.save()
        invalidatePeopleCache()
        print("[Enrollment] Augmented \(person.name) — now \(existing.count) embeddings")
    }

    // MARK: - Encounter Logging

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
                summary = transcript
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
