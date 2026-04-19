//
//  FaceRecognitionService.swift
//  FaceMemory
//
//  Uses Apple's Vision framework for face detection and generates a
//  simple embedding from face landmarks. For production-grade
//  recognition you'd swap in a CoreML model like MobileFaceNet; the
//  landmark-based approach here works as a solid starting point and
//  runs entirely on-device with zero external dependencies.
//

import Foundation
import Vision
import CoreImage
import UIKit

enum FaceRecognitionError: Error {
    case noFaceFound
    case lowQualityFace
    case embeddingFailed
}

final class FaceRecognitionService {

    static let shared = FaceRecognitionService()

    // Match threshold. Cosine similarity above this = same person.
    // 0.85 is conservative; tune based on real-world testing.
    static let matchThreshold: Float = 0.85

    // MARK: - Face Detection

    /// Detect faces in an image. Returns normalized bounding boxes.
    func detectFaces(in cgImage: CGImage) async throws -> [VNFaceObservation] {
        try await withCheckedThrowingContinuation { continuation in
            let request = VNDetectFaceRectanglesRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                let faces = (request.results as? [VNFaceObservation]) ?? []
                continuation.resume(returning: faces)
            }
            request.revision = VNDetectFaceRectanglesRequestRevision3

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    // MARK: - Embedding Generation

    /// Generate a face embedding from the largest face in an image.
    /// Uses landmarks + face capture quality as a feature vector.
    /// For better accuracy, replace this with a CoreML FaceNet model.
    func generateEmbedding(from cgImage: CGImage) async throws -> [Float] {
        let faces = try await detectFacesWithLandmarks(in: cgImage)
        guard let largestFace = faces.max(by: {
            ($0.boundingBox.width * $0.boundingBox.height) <
            ($1.boundingBox.width * $1.boundingBox.height)
        }) else {
            throw FaceRecognitionError.noFaceFound
        }

        // Quality gate: reject blurry or poorly-captured faces
        if let quality = largestFace.faceCaptureQuality, quality < 0.3 {
            throw FaceRecognitionError.lowQualityFace
        }

        return try embeddingFromObservation(largestFace)
    }

    private func detectFacesWithLandmarks(in cgImage: CGImage) async throws -> [VNFaceObservation] {
        try await withCheckedThrowingContinuation { continuation in
            let landmarksRequest = VNDetectFaceLandmarksRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                let faces = (request.results as? [VNFaceObservation]) ?? []
                continuation.resume(returning: faces)
            }
            landmarksRequest.revision = VNDetectFaceLandmarksRequestRevision3

            let qualityRequest = VNDetectFaceCaptureQualityRequest()

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try handler.perform([landmarksRequest, qualityRequest])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    /// Build a feature vector from face landmarks. We normalize landmark
    /// points relative to the face's bounding box so the embedding is
    /// translation and scale invariant.
    private func embeddingFromObservation(_ obs: VNFaceObservation) throws -> [Float] {
        guard let landmarks = obs.landmarks else {
            throw FaceRecognitionError.embeddingFailed
        }

        var vector: [Float] = []

        // Collect all available landmark regions
        let regions: [VNFaceLandmarkRegion2D?] = [
            landmarks.leftEye, landmarks.rightEye,
            landmarks.leftEyebrow, landmarks.rightEyebrow,
            landmarks.nose, landmarks.noseCrest, landmarks.medianLine,
            landmarks.outerLips, landmarks.innerLips,
            landmarks.faceContour, landmarks.leftPupil, landmarks.rightPupil
        ]

        for region in regions {
            guard let region = region else {
                // Pad with zeros to keep vector length consistent
                vector.append(contentsOf: [Float](repeating: 0, count: 20))
                continue
            }
            let points = region.normalizedPoints
            // Sample up to 10 points per region
            let sampled = stride(from: 0, to: points.count, by: max(1, points.count / 10))
                .prefix(10)
                .map { points[$0] }

            for pt in sampled {
                vector.append(Float(pt.x))
                vector.append(Float(pt.y))
            }
            // Pad if region had fewer than 10 points
            let padding = 20 - (sampled.count * 2)
            if padding > 0 {
                vector.append(contentsOf: [Float](repeating: 0, count: padding))
            }
        }

        // Append geometric ratios as additional features
        if let leftEye = landmarks.leftEye?.normalizedPoints,
           let rightEye = landmarks.rightEye?.normalizedPoints,
           let nose = landmarks.nose?.normalizedPoints,
           !leftEye.isEmpty, !rightEye.isEmpty, !nose.isEmpty {
            let leftCenter = centroid(leftEye)
            let rightCenter = centroid(rightEye)
            let noseCenter = centroid(nose)

            vector.append(Float(distance(leftCenter, rightCenter)))
            vector.append(Float(distance(leftCenter, noseCenter)))
            vector.append(Float(distance(rightCenter, noseCenter)))
        } else {
            vector.append(contentsOf: [0, 0, 0])
        }

        return normalize(vector)
    }

    // MARK: - Matching

    /// Find the best match for a query embedding among a list of candidates.
    /// Returns nil if no candidate is above the similarity threshold.
    func findMatch(query: [Float], among people: [Person]) -> (person: Person, similarity: Float)? {
        var best: (Person, Float)? = nil
        for person in people {
            let candidate = person.faceEmbedding
            guard candidate.count == query.count else { continue }
            let sim = cosineSimilarity(query, candidate)
            if sim >= Self.matchThreshold {
                if best == nil || sim > best!.1 {
                    best = (person, sim)
                }
            }
        }
        return best
    }

    // MARK: - Math Utilities

    private func centroid(_ points: [CGPoint]) -> CGPoint {
        guard !points.isEmpty else { return .zero }
        let sum = points.reduce(CGPoint.zero) { CGPoint(x: $0.x + $1.x, y: $0.y + $1.y) }
        return CGPoint(x: sum.x / CGFloat(points.count), y: sum.y / CGFloat(points.count))
    }

    private func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
        let dx = a.x - b.x
        let dy = a.y - b.y
        return sqrt(dx * dx + dy * dy)
    }

    private func normalize(_ v: [Float]) -> [Float] {
        let magnitude = sqrt(v.map { $0 * $0 }.reduce(0, +))
        guard magnitude > 0 else { return v }
        return v.map { $0 / magnitude }
    }

    private func cosineSimilarity(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count else { return 0 }
        var dot: Float = 0
        var magA: Float = 0
        var magB: Float = 0
        for i in 0..<a.count {
            dot += a[i] * b[i]
            magA += a[i] * a[i]
            magB += b[i] * b[i]
        }
        let denom = sqrt(magA) * sqrt(magB)
        return denom == 0 ? 0 : dot / denom
    }
}
