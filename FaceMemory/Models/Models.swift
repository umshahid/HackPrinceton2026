//
//  Models.swift
//  FaceMemory
//
//  Core data models. Person stores the face embedding (as Data) plus
//  identity fields. Encounter logs each time you meet that person, with
//  an optional conversation summary.
//

import Foundation
import SwiftData

@Model
final class Person {
    @Attribute(.unique) var id: UUID
    var name: String
    var enrolledDate: Date
    var lastSeenDate: Date

    // Face embedding stored as raw float data. We encode a [Float] into
    // Data via withUnsafeBufferPointer so it round-trips cleanly.
    var faceEmbeddingData: Data

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
        faceEmbedding: [Float],
        visualDescription: String = "",
        notes: String = "",
        photoData: Data? = nil
    ) {
        self.id = id
        self.name = name
        self.enrolledDate = enrolledDate
        self.lastSeenDate = lastSeenDate
        self.faceEmbeddingData = Data(
            bytes: faceEmbedding,
            count: faceEmbedding.count * MemoryLayout<Float>.size
        )
        self.visualDescription = visualDescription
        self.notes = notes
        self.photoData = photoData
    }

    var faceEmbedding: [Float] {
        get {
            let count = faceEmbeddingData.count / MemoryLayout<Float>.size
            return faceEmbeddingData.withUnsafeBytes { raw in
                Array(raw.bindMemory(to: Float.self).prefix(count))
            }
        }
        set {
            faceEmbeddingData = Data(
                bytes: newValue,
                count: newValue.count * MemoryLayout<Float>.size
            )
        }
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
