//
//  EnrollmentSheet.swift
//  FaceMemory
//

import SwiftUI

struct EnrollmentSheet: View {
    let image: UIImage
    let onEnroll: (_ name: String, _ notes: String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String = ""
    @State private var notes: String = ""
    @State private var consentAcknowledged: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Spacer()
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 140, height: 140)
                            .clipShape(Circle())
                            .overlay(Circle().stroke(Color.accentColor, lineWidth: 2))
                        Spacer()
                    }
                    .padding(.vertical, 8)
                    .listRowBackground(Color.clear)
                }

                Section("Details") {
                    TextField("Name", text: $name)
                        .textInputAutocapitalization(.words)
                    TextField("Notes (optional)", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section {
                    Toggle(isOn: $consentAcknowledged) {
                        Text("This person knows I'm saving their face and notes for my personal memory aid.")
                            .font(.footnote)
                    }
                } footer: {
                    Text("Face data is stored locally on your device. You're responsible for complying with local privacy laws — get consent before enrolling someone.")
                        .font(.caption2)
                }
            }
            .navigationTitle("New Person")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onEnroll(name, notes)
                        dismiss()
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || !consentAcknowledged)
                }
            }
        }
    }
}
