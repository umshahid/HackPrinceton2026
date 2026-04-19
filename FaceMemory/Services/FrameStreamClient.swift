//
//  FrameStreamClient.swift
//  FaceMemory
//
//  Streams JPEG frames to the persona-mvp frame server over WebSocket.
//  Each frame is sent as a single binary message (raw JPEG bytes).
//

import Foundation
import UIKit
import Combine

@MainActor
final class FrameStreamClient: ObservableObject {

    static let shared = FrameStreamClient()

    @Published private(set) var isConnected: Bool = false
    @Published private(set) var statusMessage: String = "Not connected"
    @Published var serverHost: String {
        didSet { UserDefaults.standard.set(serverHost, forKey: Self.hostKey) }
    }
    @Published var serverPort: Int {
        didSet { UserDefaults.standard.set(serverPort, forKey: Self.portKey) }
    }
    @Published var streamingEnabled: Bool = false {
        didSet {
            if streamingEnabled { connect() } else { disconnect() }
        }
    }

    private static let hostKey = "frameServerHost"
    private static let portKey = "frameServerPort"

    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var reconnectWorkItem: DispatchWorkItem?
    private var framesSent: Int = 0

    private let jpegQuality: CGFloat = 0.85

    init() {
        self.serverHost = UserDefaults.standard.string(forKey: Self.hostKey) ?? ""
        let port = UserDefaults.standard.integer(forKey: Self.portKey)
        self.serverPort = port > 0 ? port : 3001
    }

    // MARK: - Connection

    func connect() {
        guard !serverHost.isEmpty else {
            statusMessage = "No server host configured"
            return
        }
        disconnect()

        let urlString = "ws://\(serverHost):\(serverPort)/ingest"
        guard let url = URL(string: urlString) else {
            statusMessage = "Invalid URL: \(urlString)"
            return
        }

        statusMessage = "Connecting to \(serverHost):\(serverPort)…"

        let session = URLSession(configuration: .default)
        self.urlSession = session
        let task = session.webSocketTask(with: url)
        self.webSocketTask = task
        task.resume()

        // URLSessionWebSocketTask doesn't have a delegate-based onOpen,
        // so we send a ping to verify the connection.
        task.sendPing { [weak self] error in
            Task { @MainActor in
                guard let self = self else { return }
                if let error {
                    self.isConnected = false
                    self.statusMessage = "Connection failed: \(error.localizedDescription)"
                    self.scheduleReconnect()
                } else {
                    self.isConnected = true
                    self.statusMessage = "Connected to \(self.serverHost):\(self.serverPort)"
                    self.framesSent = 0
                    print("[FrameStream] Connected to \(urlString)")
                }
            }
        }

        listenForDisconnect()
    }

    func disconnect() {
        reconnectWorkItem?.cancel()
        reconnectWorkItem = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        isConnected = false
        if streamingEnabled {
            statusMessage = "Disconnected"
        } else {
            statusMessage = "Not connected"
        }
    }

    // MARK: - Frame Sending

    func sendFrame(_ image: UIImage) {
        guard isConnected, let task = webSocketTask else { return }
        guard let jpegData = image.jpegData(compressionQuality: jpegQuality) else { return }

        let message = URLSessionWebSocketTask.Message.data(jpegData)
        task.send(message) { [weak self] error in
            Task { @MainActor in
                guard let self = self else { return }
                if let error {
                    print("[FrameStream] Send error: \(error.localizedDescription)")
                    self.isConnected = false
                    self.statusMessage = "Send failed"
                    self.scheduleReconnect()
                } else {
                    self.framesSent += 1
                    if self.framesSent % 10 == 0 {
                        print("[FrameStream] Sent \(self.framesSent) frames (\(jpegData.count) bytes last)")
                    }
                }
            }
        }
    }

    // MARK: - Reconnection

    private func scheduleReconnect() {
        guard streamingEnabled else { return }
        reconnectWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            Task { @MainActor in
                self?.connect()
            }
        }
        reconnectWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0, execute: work)
        statusMessage = "Reconnecting in 3s…"
    }

    private func listenForDisconnect() {
        webSocketTask?.receive { [weak self] result in
            Task { @MainActor in
                guard let self = self else { return }
                switch result {
                case .success:
                    // Server shouldn't send us anything, but keep listening
                    self.listenForDisconnect()
                case .failure(let error):
                    print("[FrameStream] Receive error (disconnect): \(error.localizedDescription)")
                    self.isConnected = false
                    self.statusMessage = "Disconnected"
                    self.scheduleReconnect()
                }
            }
        }
    }
}
