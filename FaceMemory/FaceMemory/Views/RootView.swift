//
//  RootView.swift
//  FaceMemory
//

import SwiftUI
import SwiftData

struct RootView: View {
    @Environment(\.modelContext) private var modelContext

    @StateObject private var streamManager = GlassesStreamManager.shared
    @StateObject private var coordinator = RecognitionCoordinator()
    @StateObject private var transcription = TranscriptionService.shared

    var body: some View {
        TabView {
            LiveView()
                .environmentObject(streamManager)
                .environmentObject(coordinator)
                .environmentObject(transcription)
                .tabItem { Label("Live", systemImage: "eye") }

            PeopleListView()
                .tabItem { Label("People", systemImage: "person.2") }

            SettingsView()
                .environmentObject(streamManager)
                .environmentObject(transcription)
                .tabItem { Label("Settings", systemImage: "gear") }
        }
        .task {
            coordinator.attach(modelContext: modelContext, stream: streamManager)
            await transcription.requestAuthorization()
        }
    }
}

#Preview {
    RootView()
        .modelContainer(for: [Person.self, Encounter.self], inMemory: true)
}
