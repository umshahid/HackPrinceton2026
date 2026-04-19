//
//  FaceRecognitionService.swift
//  FaceMemory
//
//  Uses Apple's Vision framework for face detection + landmark-based
//  alignment, and AdaFace IR-18 via CoreML for the identity embedding.
//  AdaFace is specifically tuned for low-quality inputs like Ray-Ban
//  Meta glasses frames.
//
//  Model: AdaFace IR-18 (john-rocky/CoreML-Models)
//  Input:  face_image — Image (Color 112x112). Model handles BGR
//          normalization internally via Mul(1/127.5) + Add(-1.0).
//  Output: embedding — MultiArray (Float16, 1x512). L2-normalized
//          after widening to Float32 for storage.
//  Metric: cosine similarity (dot product on L2-normalized vectors).
//
//  Matching: each Person has multiple enrollment embeddings; we compare
//  the query against all of them and take the maximum similarity.
//

import Foundation
import Vision
import CoreImage
import CoreML
import UIKit
import Accelerate

enum FaceRecognitionError: Error {
    case noFaceFound
    case lowQualityFace
    case embeddingFailed
    case croppingFailed
    case modelLoadFailed
}

final class FaceRecognitionService {

    static let shared = FaceRecognitionService()

    // Cosine similarity threshold. Higher = stricter.
    // IR-18 with multi-frame enrollment typically produces same-person
    // similarities in [0.45, 0.65] and stranger similarities in [0.10, 0.25].
    // 0.30 is a comfortable middle. Tune against real logs.
    static let matchSimilarityThreshold: Float = 0.30

    // Quality gate for runtime matching. Low bar — we want to try to
    // match even imperfect frames.
    static let minCaptureQuality: Float = 0.3

    // Quality gate for enrollment. Higher bar — a bad reference
    // embedding degrades accuracy for the lifetime of that profile.
    static let minEnrollmentQuality: Float = 0.55

    // AdaFace input resolution.
    private static let adaFaceInputSize: Int = 112

    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])

    // Lazy-loaded CoreML model. Uses .all so CoreML can route Float16
    // ops to the Apple Neural Engine automatically.
    private lazy var adaFace: AdaFace? = {
        let config = MLModelConfiguration()
        config.computeUnits = .all
        return try? AdaFace(configuration: config)
    }()

    // MARK: - Warmup

    /// Forces the model to load so the first real inference doesn't pay
    /// compilation cost mid-interaction. Call once at app launch from a
    /// background task.
    func warmUp() {
        _ = adaFace
    }

    // MARK: - Face Detection (public)

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

    /// Detects faces and returns the largest along with its quality score.
    /// Useful for enrollment where you want to gate on quality before
    /// proceeding to embedding.
    func detectLargestFaceWithQuality(
        in cgImage: CGImage
    ) async throws -> (face: VNFaceObservation, quality: Float)? {
        let faces = try await detectFacesWithLandmarksAndQuality(in: cgImage)
        guard let largest = faces.max(by: { a, b in
            let areaA = Float(a.boundingBox.width) * Float(a.boundingBox.height)
            let areaB = Float(b.boundingBox.width) * Float(b.boundingBox.height)
            return areaA < areaB
        }) else { return nil }
        return (largest, largest.faceCaptureQuality ?? 0)
    }

    // MARK: - Embedding Generation

    /// Generates a 512-d L2-normalized face embedding from a frame.
    /// Uses the runtime quality gate (lower bar than enrollment).
    func generateEmbedding(from cgImage: CGImage) async throws -> [Float] {
        try await generateEmbedding(from: cgImage, minQuality: Self.minCaptureQuality)
    }

    /// Generates an embedding with a custom quality gate. Used by
    /// enrollment to require higher quality references.
    func generateEmbedding(from cgImage: CGImage, minQuality: Float) async throws -> [Float] {
        let faces = try await detectFacesWithLandmarksAndQuality(in: cgImage)

        guard let largestFace = faces.max(by: { a, b in
            let areaA = Float(a.boundingBox.width) * Float(a.boundingBox.height)
            let areaB = Float(b.boundingBox.width) * Float(b.boundingBox.height)
            return areaA < areaB
        }) else {
            throw FaceRecognitionError.noFaceFound
        }

        if let q = largestFace.faceCaptureQuality, q < minQuality {
            throw FaceRecognitionError.lowQualityFace
        }

        guard let aligned = alignedFaceCrop(largestFace, from: cgImage) else {
            throw FaceRecognitionError.croppingFailed
        }

        return try runAdaFace(on: aligned)
    }

    private func detectFacesWithLandmarksAndQuality(
        in cgImage: CGImage
    ) async throws -> [VNFaceObservation] {
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

    // MARK: - Alignment

    /// Aligns the face using eye landmarks so the eye line is horizontal
    /// and the inter-ocular distance is a consistent fraction of the
    /// output. Crops to 112x112 suitable for AdaFace.
    ///
    /// Vision landmark points are in normalized coords (0..1) relative to
    /// the face bounding box, bottom-left origin, y-up. boundingBox is in
    /// normalized coords relative to the whole image, same convention.
    private func alignedFaceCrop(
        _ face: VNFaceObservation,
        from cgImage: CGImage
    ) -> CGImage? {
        let imgW = CGFloat(cgImage.width)
        let imgH = CGFloat(cgImage.height)

        let bb = face.boundingBox
        let faceRect = CGRect(
            x: bb.origin.x * imgW,
            y: (1.0 - bb.origin.y - bb.height) * imgH,
            width: bb.width * imgW,
            height: bb.height * imgH
        )

        guard
            let landmarks = face.landmarks,
            let leftEye = landmarks.leftEye,
            let rightEye = landmarks.rightEye
        else {
            return bboxOnlyCrop(face, from: cgImage)
        }

        func toImagePixels(_ p: CGPoint) -> CGPoint {
            let xInBBox = p.x * faceRect.width
            let yFromTopInBBox = (1.0 - p.y) * faceRect.height
            return CGPoint(
                x: faceRect.origin.x + xInBBox,
                y: faceRect.origin.y + yFromTopInBBox
            )
        }

        func centroid(_ region: VNFaceLandmarkRegion2D) -> CGPoint {
            let pts = region.normalizedPoints
            guard !pts.isEmpty else { return .zero }
            let sum = pts.reduce(CGPoint.zero) { CGPoint(x: $0.x + $1.x, y: $0.y + $1.y) }
            return CGPoint(x: sum.x / CGFloat(pts.count), y: sum.y / CGFloat(pts.count))
        }

        let leftEyePx = toImagePixels(centroid(leftEye))
        let rightEyePx = toImagePixels(centroid(rightEye))

        let dx = rightEyePx.x - leftEyePx.x
        let dy = rightEyePx.y - leftEyePx.y
        let angle = atan2(dy, dx)

        let eyeMid = CGPoint(
            x: (leftEyePx.x + rightEyePx.x) / 2,
            y: (leftEyePx.y + rightEyePx.y) / 2
        )

        let iod = hypot(dx, dy)
        guard iod > 4 else { return bboxOnlyCrop(face, from: cgImage) }

        let outW = CGFloat(Self.adaFaceInputSize)
        let outH = CGFloat(Self.adaFaceInputSize)
        let targetIOD: CGFloat = 42
        let scale = targetIOD / iod
        let targetEyeMid = CGPoint(x: outW / 2, y: outH * 0.4)

        let ciImage = CIImage(cgImage: cgImage)
        let imgHeight = ciImage.extent.height

        let eyeMidCI = CGPoint(x: eyeMid.x, y: imgHeight - eyeMid.y)
        let targetEyeMidCI = CGPoint(x: targetEyeMid.x, y: outH - targetEyeMid.y)

        var t = CGAffineTransform.identity
        t = t.translatedBy(x: targetEyeMidCI.x, y: targetEyeMidCI.y)
        t = t.scaledBy(x: scale, y: scale)
        t = t.rotated(by: angle)
        t = t.translatedBy(x: -eyeMidCI.x, y: -eyeMidCI.y)

        let transformed = ciImage.transformed(by: t)
        let cropRect = CGRect(x: 0, y: 0, width: outW, height: outH)
        let cropped = transformed.cropped(to: cropRect)

        return ciContext.createCGImage(cropped, from: cropRect)
    }

    private func bboxOnlyCrop(_ face: VNFaceObservation, from cgImage: CGImage) -> CGImage? {
        let imgW = CGFloat(cgImage.width)
        let imgH = CGFloat(cgImage.height)
        let bb = face.boundingBox
        let rect = CGRect(
            x: bb.origin.x * imgW,
            y: (1.0 - bb.origin.y - bb.height) * imgH,
            width: bb.width * imgW,
            height: bb.height * imgH
        )
        let margin: CGFloat = 0.15
        let expanded = rect.insetBy(dx: -rect.width * margin, dy: -rect.height * margin)
        let clamped = expanded.intersection(CGRect(x: 0, y: 0, width: imgW, height: imgH))
        guard !clamped.isNull, clamped.width > 20, clamped.height > 20,
              let cropped = cgImage.cropping(to: clamped) else { return nil }

        let outSize = CGFloat(Self.adaFaceInputSize)
        let ci = CIImage(cgImage: cropped)
        let sx = outSize / ci.extent.width
        let sy = outSize / ci.extent.height
        let scaled = ci.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
        return ciContext.createCGImage(
            scaled,
            from: CGRect(x: 0, y: 0, width: outSize, height: outSize)
        )
    }

    // MARK: - AdaFace Inference

    private func runAdaFace(on cgImage: CGImage) throws -> [Float] {
        guard let model = adaFace else { throw FaceRecognitionError.modelLoadFailed }
        guard let pixelBuffer = pixelBuffer(from: cgImage, size: Self.adaFaceInputSize) else {
            throw FaceRecognitionError.embeddingFailed
        }

        let input = AdaFaceInput(face_image: pixelBuffer)
        let output = try model.prediction(input: input)
        let arr = output.embedding

        return l2Normalize(mlArrayFloat16ToFloats(arr))
    }

    private func pixelBuffer(from cgImage: CGImage, size: Int) -> CVPixelBuffer? {
        let attrs: [CFString: Any] = [
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true
        ]
        var pb: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault,
            size, size,
            kCVPixelFormatType_32BGRA,
            attrs as CFDictionary,
            &pb
        )
        guard status == kCVReturnSuccess, let buffer = pb else { return nil }

        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

        guard let ctx = CGContext(
            data: CVPixelBufferGetBaseAddress(buffer),
            width: size,
            height: size,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
                | CGBitmapInfo.byteOrder32Little.rawValue
        ) else {
            return nil
        }

        ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: size, height: size))
        return buffer
    }

    private func mlArrayFloat16ToFloats(_ arr: MLMultiArray) -> [Float] {
        let count = arr.count
        var floats = [Float](repeating: 0, count: count)

        switch arr.dataType {
        case .float16:
            let src = arr.dataPointer.bindMemory(to: UInt16.self, capacity: count)
            var srcBuffer = vImage_Buffer(
                data: UnsafeMutablePointer(mutating: src),
                height: 1,
                width: UInt(count),
                rowBytes: count * MemoryLayout<UInt16>.size
            )
            floats.withUnsafeMutableBufferPointer { fptr in
                var dstBuffer = vImage_Buffer(
                    data: fptr.baseAddress,
                    height: 1,
                    width: UInt(count),
                    rowBytes: count * MemoryLayout<Float>.size
                )
                vImageConvert_Planar16FtoPlanarF(&srcBuffer, &dstBuffer, 0)
            }

        case .float32:
            let src = arr.dataPointer.bindMemory(to: Float.self, capacity: count)
            for i in 0..<count { floats[i] = src[i] }

        case .double:
            let src = arr.dataPointer.bindMemory(to: Double.self, capacity: count)
            for i in 0..<count { floats[i] = Float(src[i]) }

        @unknown default:
            let src = arr.dataPointer.bindMemory(to: Float.self, capacity: count)
            for i in 0..<count { floats[i] = src[i] }
        }

        return floats
    }

    private func l2Normalize(_ v: [Float]) -> [Float] {
        var out = v
        var sumSq: Float = 0
        vDSP_svesq(v, 1, &sumSq, vDSP_Length(v.count))
        var norm = sqrt(sumSq)
        if norm < 1e-8 { norm = 1 }
        var inv = 1 / norm
        vDSP_vsmul(v, 1, &inv, &out, 1, vDSP_Length(v.count))
        return out
    }

    // MARK: - Matching

    /// Finds the best match across all enrolled people. For each person,
    /// computes the maximum cosine similarity across all their stored
    /// enrollment embeddings, then returns the person with the highest
    /// max — if that max clears the threshold.
    func findMatch(query: [Float], among people: [Person]) -> (person: Person, similarity: Float)? {
        var best: (Person, Float)? = nil

        for person in people {
            var personBest: Float = -2  // lower than any possible cosine similarity
            for candidate in person.faceEmbeddings {
                guard candidate.count == query.count else { continue }
                let s = cosineSimilarity(query, candidate)
                if s > personBest { personBest = s }
            }
            // Skip people with no usable embeddings.
            guard personBest > -1 else { continue }

            if personBest > (best?.1 ?? -2) {
                best = (person, personBest)
            }
        }

        guard let (person, sim) = best else { return nil }
        return sim >= Self.matchSimilarityThreshold ? (person, sim) : nil
    }

    /// Public wrapper for diagnostic logging. Assumes both vectors are
    /// L2-normalized.
    func cosineSimilarityPublic(_ a: [Float], _ b: [Float]) -> Float {
        cosineSimilarity(a, b)
    }

    private func cosineSimilarity(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count else { return -1 }
        var dot: Float = 0
        vDSP_dotpr(a, 1, b, 1, &dot, vDSP_Length(a.count))
        return dot
    }
}
