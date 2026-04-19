//
//  SettingsView.swift
//  FaceMemory
//

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var stream: GlassesStreamManager
    @EnvironmentObject private var transcription: TranscriptionService
    @ObservedObject private var frameClient = FrameStreamClient.shared

    private var apiKeyConfigured: Bool {
        if let key = Bundle.main.object(forInfoDictionaryKey: "GEMINI_API_KEY") as? String,
           !key.isEmpty, !key.contains("YOUR_KEY") {
            return true
        }
        return false
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Meta Glasses") {
                    LabeledContent("Status", value: stream.statusMessage)
                    LabeledContent("Registered", value: stream.isRegistered ? "Yes" : "No")
                    LabeledContent("Streaming", value: stream.isStreaming ? "Yes" : "No")

                    Button("Register with Meta AI app") {
                        print("[FaceMemory] Register button tapped")
                        stream.startRegistration()
                    }
                    if stream.isRegistered {
                        Button("Unregister", role: .destructive) {
                            print("[FaceMemory] Unregister button tapped")
                            stream.startUnregistration()
                        }
                    }
                }

                Section("Transcription") {
                    LabeledContent("Status") {
                        Text(transcription.isTranscribing ? "Active" : "Idle")
                            .foregroundColor(transcription.isTranscribing ? .green : .secondary)
                    }
                    LabeledContent("Authorization") {
                        Text(authLabel)
                    }
                    if !transcription.currentTranscript.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Recent transcript").font(.caption).foregroundColor(.secondary)
                            Text(transcription.currentTranscript).font(.footnote)
                        }
                    }
                }

                Section("Persona Frame Server") {
                    TextField("Mac IP address", text: $frameClient.serverHost)
                        .keyboardType(.decimalPad)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    LabeledContent("Port", value: "\(frameClient.serverPort)")
                    LabeledContent("Status", value: frameClient.statusMessage)

                    Toggle("Stream to Persona", isOn: $frameClient.streamingEnabled)

                    if frameClient.isConnected {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Connected")
                        }
                    }

                    Text("Enter your Mac's local IP (e.g. 192.168.1.42). The frame server must be running on port \(frameClient.serverPort).")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Section("Gemini VLM") {
                    HStack {
                        Image(systemName: apiKeyConfigured ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                            .foregroundColor(apiKeyConfigured ? .green : .orange)
                        Text(apiKeyConfigured ? "API key configured" : "API key not set")
                    }
                    if !apiKeyConfigured {
                        Text("Set GEMINI_API_KEY in Info.plist to enable VLM descriptions and conversation summaries.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Section("About") {
                    Text("Face Memory uses on-device face detection. When you enroll someone, the image is also sent to Google's Gemini API to generate a written description. All face data and notes are stored locally on this device.")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }

                Section {
                    Link("Google AI Studio",
                         destination: URL(string: "https://aistudio.google.com/app/apikey")!)
                    Link("Meta Wearables Developer Center",
                         destination: URL(string: "https://wearables.developer.meta.com")!)
                }
            }
            .navigationTitle("Settings")
        }
    }

    private var authLabel: String {
        switch transcription.authorizationStatus {
        case .authorized: return "Authorized"
        case .denied: return "Denied"
        case .restricted: return "Restricted"
        case .notDetermined: return "Not asked"
        @unknown default: return "Unknown"
        }
    }
}
