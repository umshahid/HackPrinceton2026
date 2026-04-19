//
//  FaceRecognitionService.swift
//  FaceMemory
//
//  Uses Apple's Vision framework for both face detection AND embedding.
//  The embedding comes from VNGenerateImageFeaturePrintRequest run on a
//  tight face crop — a learned model, far more identity-discriminative
//  than the previous landmark-geometry approach.
//

import Foundation
import Vision
import CoreImage
import UIKit

enum FaceRecognitionError: Error {
    case noFaceFound
    case lowQualityFace
    case embeddingFailed
    case croppingFailed
}

final class FaceRecognitionService {

    static let shared = FaceRecognitionService()

    // Feature print distance threshold. Vision returns a DISTANCE (lower =
    // more similar), not a similarity. Empirically for face crops:
    //   - same person, similar pose:  distance ~0.4 to 0.7
    //   - same person, different:     distance ~0.7 to 1.0
    //   - different people:           distance >1.0, often >1.3
    // Start at 0.9. If you get false positives, lower it toward 0.7.
    // If you get false negatives, raise it toward 1.1.
    static let matchDistanceThreshold: Float = 0.9

    // MARK: - Face Detection

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

    /// Generates a face embedding by:
    ///   1. detecting the largest face in the image
    ///   2. checking face capture quality (rejects blurry/bad poses)
    ///   3. cropping tightly to the face with a small margin
    ///   4. running VNGenerateImageFeaturePrintRequest on that crop
    func generateEmbedding(from cgImage: CGImage) async throws -> [Float] {
        let faces = try await detectFacesWithQuality(in: cgImage)

        guard let largestFace = faces.max(by: { a, b in
            let areaA = Float(a.boundingBox.width) * Float(a.boundingBox.height)
            let areaB = Float(b.boundingBox.width) * Float(b.boundingBox.height)
            return areaA < areaB
        }) else {
            throw FaceRecognitionError.noFaceFound
        }

        if let quality = largestFace.faceCaptureQuality, quality < 0.3 {
            throw FaceRecognitionError.lowQualityFace
        }

        guard let cropped = cropFace(largestFace, from: cgImage) else {
            throw FaceRecognitionError.croppingFailed
        }

        return try await featurePrint(from: cropped)
    }

    private func detectFacesWithQuality(in cgImage: CGImage) async throws -> [VNFaceObservation] {
        try await withCheckedThrowingContinuation { continuation in
            let rectRequest = VNDetectFaceRectanglesRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                let faces = (request.results as? [VNFaceObservation]) ?? []
                continuation.resume(returning: faces)
            }
            rectRequest.revision = VNDetectFaceRectanglesRequestRevision3

            let qualityRequest = VNDetectFaceCaptureQualityRequest()

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try handler.perform([rectRequest, qualityRequest])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    /// Crops the image to the face bounding box with a 25% margin on each side.
    /// Vision returns normalized coordinates (0..1) with origin at bottom-left.
    private func cropFace(_ face: VNFaceObservation, from cgImage: CGImage) -> CGImage? {
        let imgWidth = CGFloat(cgImage.width)
        let imgHeight = CGFloat(cgImage.height)

        let bb = face.boundingBox
        let faceRectInPixels = CGRect(
            x: bb.origin.x * imgWidth,
            y: (1.0 - bb.origin.y - bb.height) * imgHeight,
            width: bb.width * imgWidth,
            height: bb.height * imgHeight
        )

        let margin: CGFloat = 0.25
        let expanded = faceRectInPixels.insetBy(
            dx: -faceRectInPixels.width * margin,
            dy: -faceRectInPixels.height * margin
        )

        let clamped = expanded.intersection(CGRect(x: 0, y: 0, width: imgWidth, height: imgHeight))
        guard !clamped.isNull, clamped.width > 20, clamped.height > 20 else {
            return nil
        }

        return cgImage.cropping(to: clamped)
    }

    /// Runs VNGenerateImageFeaturePrintRequest and returns the embedding as [Float].
    private func featurePrint(from cgImage: CGImage) async throws -> [Float] {
        try await withCheckedThrowingContinuation { continuation in
            let request = VNGenerateImageFeaturePrintRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let obs = (request.results as? [VNFeaturePrintObservation])?.first else {
                    continuation.resume(throwing: FaceRecognitionError.embeddingFailed)
                    return
                }

                let count = obs.elementCount
                let data = obs.data
                var floats = [Float](repeating: 0, count: count)
                data.withUnsafeBytes { raw in
                    guard let base = raw.bindMemory(to: Float.self).baseAddress else { return }
                    for i in 0..<count {
                        floats[i] = base[i]
                    }
                }
                continuation.resume(returning: floats)
            }

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    // MARK: - Matching

    /// Finds the closest candidate. If the best distance is below the
    /// threshold, returns the match; otherwise returns nil.
    func findMatch(query: [Float], among people: [Person]) -> (person: Person, distance: Float)? {
        var best: (Person, Float)? = nil
        for person in people {
            let candidate = person.faceEmbedding
            guard candidate.count == query.count else { continue }
            let d = euclideanDistance(query, candidate)
            if best == nil || d < best!.1 {
                best = (person, d)
            }
        }
        guard let (person, distance) = best else { return nil }
        if distance <= Self.matchDistanceThreshold {
            return (person, distance)
        }
        return nil
    }

    private func euclideanDistance(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count else { return .greatestFiniteMagnitude }
        var sum: Float = 0
        for i in 0..<a.count {
            let d = a[i] - b[i]
            sum += d * d
        }
        return sum.squareRoot()
    }
}
