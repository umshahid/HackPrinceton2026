//
//  GlassesStreamManager.swift
//  FaceMemory
//
//  TEMPORARY: SDK streaming path removed. Uses the phone's front camera
//  as a mock feed so the app compiles and runs while the real SDK API
//  is being verified from the CameraAccess sample.
//
//  To re-enable glasses streaming, restore the MWDATCamera code path
//  once the correct StreamSession initializer and publisher API are
//  known.
//

import Foundation
import UIKit
import Combine
import AVFoundation

@MainActor
final class GlassesStreamManager: NSObject, ObservableObject {

    static let shared = GlassesStreamManager()

    @Published private(set) var latestFrame: UIImage?
    @Published private(set) var isRegistered: Bool = false
    @Published private(set) var isStreaming: Bool = false
    @Published private(set) var statusMessage: String = "Not connected"

    private var frameCounter: Int = 0
    private let frameThrottle: Int = 6

    private let captureSession = AVCaptureSession()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let captureQueue = DispatchQueue(label: "facememory.mock.capture")

    // MARK: - Registration (no-op in phone camera mode)

    func startRegistration() {
        statusMessage = "Phone camera mode (SDK streaming disabled)"
        isRegistered = true
    }

    func startUnregistration() {
        isRegistered = false
        statusMessage = "Unregistered"
    }

    // MARK: - Streaming

    func startStreaming() {
        guard !isStreaming else { return }
        startMockCamera()
        isStreaming = true
        statusMessage = "Streaming (phone camera)"
    }

    func stopStreaming() {
        stopMockCamera()
        isStreaming = false
        statusMessage = "Stopped"
    }

    // MARK: - Frame Throttling

    private func handleFrame(_ image: UIImage) {
        frameCounter += 1
        if frameCounter % frameThrottle == 0 {
            latestFrame = image
        }
    }

    // MARK: - Phone Camera

    private func startMockCamera() {
        captureQueue.async { [weak self] in
            guard let self = self else { return }

            guard let device = AVCaptureDevice.default(
                .builtInWideAngleCamera,
                for: .video,
                position: .front
            ) else {
                return
            }
            do {
                let input = try AVCaptureDeviceInput(device: device)
                self.captureSession.beginConfiguration()
                if self.captureSession.canAddInput(input) {
                    self.captureSession.addInput(input)
                }
                self.videoOutput.setSampleBufferDelegate(self, queue: self.captureQueue)
                self.videoOutput.videoSettings = [
                    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
                ]
                if self.captureSession.canAddOutput(self.videoOutput) {
                    self.captureSession.addOutput(self.videoOutput)
                }
                self.captureSession.commitConfiguration()
                self.captureSession.startRunning()
            } catch {
                print("[GlassesStreamManager] Camera setup failed: \(error)")
            }
        }
    }

    private func stopMockCamera() {
        captureQueue.async { [weak self] in
            self?.captureSession.stopRunning()
        }
    }
}

extension GlassesStreamManager: AVCaptureVideoDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let ci = CIImage(cvPixelBuffer: pixelBuffer)
        let ctx = CIContext()
        guard let cg = ctx.createCGImage(ci, from: ci.extent) else { return }
        let image = UIImage(cgImage: cg, scale: 1.0, orientation: .right)
        Task { @MainActor in self.handleFrame(image) }
    }
}
