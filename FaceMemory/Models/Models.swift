//
//  Models.swift
//  FaceMemory
//
//  Core data models. Person stores multiple face embeddings (as [Data])
//  plus identity fields. Encounter logs each time you meet that person,
//  with an optional conversation summary.
//

import Foundation
import SwiftData

@Model
final class Person {
    @Attribute(.unique) var id: UUID
    var name: String
    var enrolledDate: Date
    var lastSeenDate: Date

    // Multiple face embeddings stored as an array of raw float data.
    // We capture 3-5 frames at enrollment and store each as its own
    // embedding. At match time we take the maximum cosine similarity
    // across all stored embeddings for a person, which handles pose
    // and lighting variation much better than a single reference.
    var faceEmbeddingsData: [Data]

    var visualDescription: String
    var notes: String
    var photoData: Data?   // thumbnail captured at enrollment

    @Relationship(deleteRule: .cascade, inverse: \Encounter.person)
    var encounters: [Encounter] = []

    init(
        id: UUID = UUID(),
        name: String,
        enrolledDate: Date = Date(),
        lastSeenDate: Date = Date(),
        faceEmbeddings: [[Float]] = [],
        visualDescription: String = "",
        notes: String = "",
        photoData: Data? = nil
    ) {
        self.id = id
        self.name = name
        self.enrolledDate = enrolledDate
        self.lastSeenDate = lastSeenDate
        self.faceEmbeddingsData = faceEmbeddings.map { embedding in
            Data(bytes: embedding, count: embedding.count * MemoryLayout<Float>.size)
        }
        self.visualDescription = visualDescription
        self.notes = notes
        self.photoData = photoData
    }

    /// All enrollment embeddings for this person, decoded from Data.
    var faceEmbeddings: [[Float]] {
        get {
            faceEmbeddingsData.map { data in
                let count = data.count / MemoryLayout<Float>.size
                return data.withUnsafeBytes { raw in
                    Array(raw.bindMemory(to: Float.self).prefix(count))
                }
            }
        }
        set {
            faceEmbeddingsData = newValue.map { embedding in
                Data(bytes: embedding, count: embedding.count * MemoryLayout<Float>.size)
            }
        }
    }

    /// True when this person has no usable embeddings (pre-migration
    /// records, or records awaiting re-enrollment).
    var needsEnrollment: Bool {
        faceEmbeddingsData.isEmpty || faceEmbeddingsData.allSatisfy { $0.isEmpty }
    }
}

@Model
final class Encounter {
    @Attribute(.unique) var id: UUID
    var date: Date
    var conversationSummary: String
    var keyTopics: [String]
    var locationName: String?

    var person: Person?

    init(
        id: UUID = UUID(),
        date: Date = Date(),
        conversationSummary: String = "",
        keyTopics: [String] = [],
        locationName: String? = nil,
        person: Person? = nil
    ) {
        self.id = id
        self.date = date
        self.conversationSummary = conversationSummary
        self.keyTopics = keyTopics
        self.locationName = locationName
        self.person = person
    }
}
