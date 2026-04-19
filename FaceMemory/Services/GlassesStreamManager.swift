//
//  GlassesStreamManager.swift
//  FaceMemory
//
//  Wraps the Meta Wearables DAT SDK. Based on CameraAccess sample's
//  StreamSessionViewModel, adapted to the FaceMemory data flow.
//
//  This version has extra print statements for debugging the registration
//  flow. Strip them out once it's working.
//

import Foundation
import UIKit
import Combine
import MWDATCore
import MWDATCamera

@MainActor
final class GlassesStreamManager: NSObject, ObservableObject {

    static let shared = GlassesStreamManager()

    @Published private(set) var latestFrame: UIImage?
    @Published private(set) var isRegistered: Bool = false
    @Published private(set) var isStreaming: Bool = false
    @Published private(set) var statusMessage: String = "Not connected"

    private var frameCounter: Int = 0
    private let frameThrottle: Int = 6

    private let sessionManager: DeviceSessionManager
    private var streamSession: StreamSession?

    private var stateToken: AnyListenerToken?
    private var frameToken: AnyListenerToken?
    private var errorToken: AnyListenerToken?

    private var cancellables: Set<AnyCancellable> = []

    override init() {
        self.sessionManager = DeviceSessionManager(wearables: Wearables.shared)
        super.init()

        sessionManager.$hasActiveDevice
            .receive(on: DispatchQueue.main)
            .sink { [weak self] active in
                print("[FaceMemory] hasActiveDevice changed: \(active)")
                self?.isRegistered = active
            }
            .store(in: &cancellables)
    }

    // MARK: - Registration

    func startRegistration() {
        print("[FaceMemory] startRegistration() called")
        statusMessage = "Opening Meta AI app…"
        Task { @MainActor in
            do {
                print("[FaceMemory] Awaiting Wearables.shared.startRegistration()")
                try await Wearables.shared.startRegistration()
                print("[FaceMemory] startRegistration() succeeded")
            } catch {
                print("[FaceMemory] startRegistration() threw: \(error)")
                self.statusMessage = "Registration failed: \(error.localizedDescription)"
            }
        }
    }

    func startUnregistration() {
        print("[FaceMemory] startUnregistration() called")
        Task { @MainActor in
            do {
                try await Wearables.shared.startUnregistration()
                print("[FaceMemory] startUnregistration() succeeded")
                self.isRegistered = false
                self.statusMessage = "Unregistered"
            } catch {
                print("[FaceMemory] startUnregistration() threw: \(error)")
                self.statusMessage = "Unregister failed: \(error.localizedDescription)"
            }
        }
    }

    // MARK: - Streaming

    func startStreaming() {
        guard !isStreaming else { return }
        statusMessage = "Requesting camera permission…"

        Task { @MainActor in
            do {
                var status = try await Wearables.shared.checkPermissionStatus(.camera)
                if status != .granted {
                    status = try await Wearables.shared.requestPermission(.camera)
                }
                guard status == .granted else {
                    self.statusMessage = "Camera permission denied"
                    return
                }
                await self.startSession()
            } catch {
                self.statusMessage = "Permission error: \(error.localizedDescription)"
            }
        }
    }

    private func startSession() async {
        guard let deviceSession = await sessionManager.getSession() else {
            statusMessage = "No device session available"
            return
        }
        guard deviceSession.state == .started else {
            statusMessage = "Device session not started"
            return
        }

        let config = StreamSessionConfig(
            videoCodec: VideoCodec.raw,
            resolution: StreamingResolution.low,
            frameRate: 24
        )

        guard let stream = try? deviceSession.addStream(config: config) else {
            statusMessage = "Failed to create stream"
            return
        }

        self.streamSession = stream
        self.isStreaming = true
        self.statusMessage = "Stream: waiting"
        self.setupListeners(for: stream)

        await stream.start()
    }

    func stopStreaming() {
        guard let stream = streamSession else {
            isStreaming = false
            statusMessage = "Stopped"
            return
        }
        streamSession = nil
        clearListeners()
        latestFrame = nil

        Task { @MainActor in
            await stream.stop()
            self.isStreaming = false
            self.statusMessage = "Stopped"
        }
    }

    // MARK: - Listeners

    private func setupListeners(for stream: StreamSession) {
        stateToken = stream.statePublisher.listen { [weak self] state in
            Task { @MainActor in self?.handleStateChange(state) }
        }

        frameToken = stream.videoFramePublisher.listen { [weak self] frame in
            Task { @MainActor in self?.handleVideoFrame(frame) }
        }

        errorToken = stream.errorPublisher.listen { [weak self] error in
            Task { @MainActor in self?.handleStreamError(error) }
        }
    }

    private func clearListeners() {
        stateToken = nil
        frameToken = nil
        errorToken = nil
    }

    private func handleStateChange(_ state: StreamSessionState) {
        switch state {
        case .stopped:
            statusMessage = "Stream: stopped"
            latestFrame = nil
            isStreaming = false
        case .waitingForDevice:
            statusMessage = "Stream: waiting for device"
        case .starting:
            statusMessage = "Stream: starting"
        case .stopping:
            statusMessage = "Stream: stopping"
        case .paused:
            statusMessage = "Stream: paused"
        case .streaming:
            statusMessage = "Streaming from glasses"
        @unknown default:
            statusMessage = "Stream: unknown state"
        }
    }

    private func handleVideoFrame(_ frame: VideoFrame) {
        guard let image = frame.makeUIImage() else { return }
        frameCounter += 1
        if frameCounter % frameThrottle == 0 {
            latestFrame = image
            // Forward to persona-mvp frame server if streaming is enabled
            FrameStreamClient.shared.sendFrame(image)
        }
    }

    private func handleStreamError(_ error: StreamSessionError) {
        switch error {
        case .internalError:       statusMessage = "Internal stream error"
        case .deviceNotFound:      statusMessage = "Device not found"
        case .deviceNotConnected:  statusMessage = "Device not connected"
        case .timeout:             statusMessage = "Stream timed out"
        case .videoStreamingError: statusMessage = "Video streaming error"
        case .permissionDenied:    statusMessage = "Camera permission denied"
        case .hingesClosed:        statusMessage = "Open your glasses hinges"
        case .thermalCritical:     statusMessage = "Glasses overheating — paused"
        @unknown default:          statusMessage = "Unknown stream error"
        }
    }
}
