//
//  FaceMemoryApp.swift
//  FaceMemory
//
//  Entry point for the app. SDK calls are temporarily disabled so the
//  project builds cleanly. Once the real SDK API signatures are
//  confirmed from the CameraAccess sample, re-enable by flipping the
//  USE_METADAT_SDK flag below to true.
//

import SwiftUI
import SwiftData

// Flip this to true after fixing GlassesStreamManager with the real SDK API
private let USE_METADAT_SDK = false

#if canImport(MWDATCore)
import MWDATCore
#endif

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
        guard USE_METADAT_SDK else {
            print("[FaceMemory] SDK disabled in flag — running in phone-camera mode.")
            return
        }
        #if canImport(MWDATCore)
        do {
            try Wearables.configure()
            print("[FaceMemory] Wearables SDK configured.")
        } catch {
            assertionFailure("Failed to configure Wearables SDK: \(error)")
        }
        #else
        print("[FaceMemory] MWDATCore not available.")
        #endif
    }

    private func handleMetaCallback(url: URL) {
        guard USE_METADAT_SDK else {
            print("[FaceMemory] Callback ignored (SDK disabled): \(url)")
            return
        }
        #if canImport(MWDATCore)
        Task {
            do {
                _ = try await Wearables.shared.handleUrl(url)
                print("[FaceMemory] Meta callback handled: \(url)")
            } catch {
                print("[FaceMemory] Callback handling failed: \(error)")
            }
        }
        #endif
    }
}
