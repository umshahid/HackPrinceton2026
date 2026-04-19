//
//  FaceMemoryApp.swift
//  FaceMemory
//

import SwiftUI
import SwiftData
import MWDATCore
import MWDATCamera

@main
struct FaceMemoryApp: App {

    let modelContainer: ModelContainer = {
        do {
            return try ModelContainer(
                for: Person.self, Encounter.self,
                configurations: ModelConfiguration(isStoredInMemoryOnly: false)
            )
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }
    }()

    init() {
        configureWearablesSDK()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .onOpenURL { url in
                    handleMetaCallback(url: url)
                }
        }
        .modelContainer(modelContainer)
    }

    private func configureWearablesSDK() {
        do {
            try Wearables.configure()
            print("[FaceMemory] Wearables SDK configured.")
        } catch {
            assertionFailure("Failed to configure Wearables SDK: \(error)")
        }
    }

    private func handleMetaCallback(url: URL) {
        Task {
            do {
                _ = try await Wearables.shared.handleUrl(url)
                print("[FaceMemory] Meta callback handled: \(url)")
            } catch {
                print("[FaceMemory] Callback handling failed: \(error)")
            }
        }
    }
}
