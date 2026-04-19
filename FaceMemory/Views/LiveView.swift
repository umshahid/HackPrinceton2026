//
//  LiveView.swift
//  FaceMemory
//
//  Main live recognition surface. Shows the current glasses/camera frame,
//  overlays recognition state, and provides the enrollment flow.
//

import SwiftUI
import SwiftData

struct LiveView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject private var stream: GlassesStreamManager
    @EnvironmentObject private var coordinator: RecognitionCoordinator
    @EnvironmentObject private var transcription: TranscriptionService

    @State private var showingEnrollSheet = false
    @State private var enrollmentImage: UIImage?
    @State private var showingMatchDetail: UUID?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                if let frame = stream.latestFrame {
                    Image(uiImage: frame)
                        .resizable()
                        .scaledToFit()
                        .ignoresSafeArea()
                } else {
                    VStack(spacing: 16) {
                        Image(systemName: "eye.slash")
                            .font(.system(size: 60))
                            .foregroundColor(.white.opacity(0.5))
                        Text("No stream active")
                            .foregroundColor(.white.opacity(0.7))
                        Text(stream.statusMessage)
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.5))
                    }
                }

                VStack {
                    Spacer()
                    recognitionCard
                    controlBar
                }
                .padding()
            }
            .navigationTitle("Face Memory")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showingEnrollSheet) {
                if let image = enrollmentImage {
                    EnrollmentSheet(image: image) { name, notes in
                        Task {
                            do {
                                _ = try await coordinator.enroll(
                                    name: name, image: image, notes: notes
                                )
                            } catch {
                                print("[Enroll] failed: \(error)")
                            }
                        }
                    }
                }
            }
            .sheet(item: Binding(
                get: { showingMatchDetail.map { IdentifiableUUID(id: $0) } },
                set: { showingMatchDetail = $0?.id }
            )) { wrapper in
                PersonDetailFromID(personID: wrapper.id)
            }
        }
    }

    // MARK: - Recognition Card

    @ViewBuilder
    private var recognitionCard: some View {
        switch coordinator.state {
        case .idle:
            EmptyView()
        case .scanning:
            statusPill(text: "Scanning…", color: .blue)
        case .noFace:
            statusPill(text: "No face detected", color: .gray)
        case .matched(let id, let similarity, let name):
            Button {
                showingMatchDetail = id
            } label: {
                HStack {
                    Image(systemName: "person.fill.checkmark")
                        .foregroundColor(.green)
                    VStack(alignment: .leading) {
                        Text(name).font(.headline).foregroundColor(.white)
                        Text("Match confidence \(Int(similarity * 100))%")
                            .font(.caption).foregroundColor(.white.opacity(0.7))
                    }
                    Spacer()
                    Image(systemName: "chevron.right").foregroundColor(.white.opacity(0.7))
                }
                .padding()
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
            }
        case .stranger(let image):
            HStack {
                Image(systemName: "person.fill.questionmark")
                    .foregroundColor(.yellow)
                Text("Unknown person")
                    .font(.headline).foregroundColor(.white)
                Spacer()
                Button("Enroll") {
                    enrollmentImage = image
                    showingEnrollSheet = true
                }
                .buttonStyle(.borderedProminent)
                .tint(.blue)
            }
            .padding()
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private func statusPill(text: String, color: Color) -> some View {
        HStack(spacing: 8) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(text).font(.caption).foregroundColor(.white)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(.ultraThinMaterial, in: Capsule())
    }

    // MARK: - Controls

    private var controlBar: some View {
        HStack(spacing: 12) {
            Button {
                if stream.isStreaming {
                    stream.stopStreaming()
                    coordinator.stop()
                } else {
                    stream.startStreaming()
                    coordinator.start()
                }
            } label: {
                Label(stream.isStreaming ? "Stop" : "Start",
                      systemImage: stream.isStreaming ? "stop.circle.fill" : "play.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(stream.isStreaming ? .red : .green)

            Button {
                if transcription.isTranscribing {
                    transcription.stopTranscribing()
                } else {
                    try? transcription.startTranscribing()
                }
            } label: {
                Label(transcription.isTranscribing ? "Mute" : "Listen",
                      systemImage: transcription.isTranscribing ? "mic.fill" : "mic.slash.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(.white)

            Button {
                capturePhotoForEnrollment()
            } label: {
                Image(systemName: "camera.fill")
                    .frame(maxWidth: 44)
            }
            .buttonStyle(.bordered)
            .tint(.white)
        }
    }

    private func capturePhotoForEnrollment() {
        guard let frame = stream.latestFrame else { return }
        enrollmentImage = frame
        showingEnrollSheet = true
    }
}

private struct IdentifiableUUID: Identifiable { let id: UUID }

private struct PersonDetailFromID: View {
    let personID: UUID
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        if let person = fetchPerson() {
            NavigationStack { PersonDetailView(person: person) }
        } else {
            Text("Person not found").padding()
        }
    }

    private func fetchPerson() -> Person? {
        let id = personID
        let descriptor = FetchDescriptor<Person>(predicate: #Predicate { $0.id == id })
        return try? modelContext.fetch(descriptor).first
    }
}
