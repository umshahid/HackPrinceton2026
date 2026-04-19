//
//  PeopleViews.swift
//  FaceMemory
//

import SwiftUI
import SwiftData

struct PeopleListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Person.lastSeenDate, order: .reverse) private var people: [Person]
    @State private var searchText: String = ""

    var filtered: [Person] {
        guard !searchText.isEmpty else { return people }
        return people.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.notes.localizedCaseInsensitiveContains(searchText) ||
            $0.visualDescription.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if filtered.isEmpty {
                    ContentUnavailableView(
                        "No one enrolled yet",
                        systemImage: "person.crop.circle.badge.questionmark",
                        description: Text("Enroll someone from the Live tab.")
                    )
                } else {
                    ForEach(filtered) { person in
                        NavigationLink(value: person.id) {
                            PersonRow(person: person)
                        }
                    }
                    .onDelete { indices in
                        for i in indices {
                            modelContext.delete(filtered[i])
                        }
                        try? modelContext.save()
                    }
                }
            }
            .navigationTitle("People")
            .searchable(text: $searchText)
            .navigationDestination(for: UUID.self) { id in
                if let person = people.first(where: { $0.id == id }) {
                    PersonDetailView(person: person)
                }
            }
        }
    }
}

struct PersonRow: View {
    let person: Person

    var body: some View {
        HStack(spacing: 12) {
            if let data = person.photoData, let ui = UIImage(data: data) {
                Image(uiImage: ui)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 50, height: 50)
                    .clipShape(Circle())
            } else {
                Image(systemName: "person.circle.fill")
                    .resizable()
                    .frame(width: 50, height: 50)
                    .foregroundColor(.secondary)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(person.name).font(.headline)
                Text("Last seen \(person.lastSeenDate.formatted(.relative(presentation: .named)))")
                    .font(.caption)
                    .foregroundColor(.secondary)
                if !person.encounters.isEmpty {
                    Text("\(person.encounters.count) encounter\(person.encounters.count == 1 ? "" : "s")")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
        }
    }
}

struct PersonDetailView: View {
    @Bindable var person: Person
    @Environment(\.modelContext) private var modelContext
    @State private var isEditing: Bool = false

    var body: some View {
        Form {
            Section {
                HStack {
                    Spacer()
                    if let data = person.photoData, let ui = UIImage(data: data) {
                        Image(uiImage: ui)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 160, height: 160)
                            .clipShape(Circle())
                    } else {
                        Image(systemName: "person.circle.fill")
                            .resizable()
                            .frame(width: 160, height: 160)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                }
                .listRowBackground(Color.clear)
            }

            Section("Name") {
                if isEditing {
                    TextField("Name", text: $person.name)
                } else {
                    Text(person.name).font(.title3.weight(.semibold))
                }
            }

            if !person.visualDescription.isEmpty {
                Section("Appearance") {
                    Text(person.visualDescription)
                        .font(.callout)
                }
            }

            Section("Notes") {
                if isEditing {
                    TextField("Notes", text: $person.notes, axis: .vertical)
                        .lineLimit(3...10)
                } else if person.notes.isEmpty {
                    Text("No notes").foregroundColor(.secondary)
                } else {
                    Text(person.notes)
                }
            }

            Section("Timeline") {
                LabeledContent("Enrolled", value: person.enrolledDate.formatted(date: .abbreviated, time: .shortened))
                LabeledContent("Last seen", value: person.lastSeenDate.formatted(.relative(presentation: .named)))
            }

            if !person.encounters.isEmpty {
                Section("Encounters (\(person.encounters.count))") {
                    ForEach(person.encounters.sorted(by: { $0.date > $1.date })) { encounter in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(encounter.date.formatted(date: .abbreviated, time: .shortened))
                                .font(.caption).foregroundColor(.secondary)
                            if !encounter.conversationSummary.isEmpty {
                                Text(encounter.conversationSummary).font(.callout)
                            }
                            if !encounter.keyTopics.isEmpty {
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack {
                                        ForEach(encounter.keyTopics, id: \.self) { topic in
                                            Text(topic)
                                                .font(.caption2)
                                                .padding(.horizontal, 8).padding(.vertical, 4)
                                                .background(Color.accentColor.opacity(0.15))
                                                .foregroundColor(.accentColor)
                                                .clipShape(Capsule())
                                        }
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
        }
        .navigationTitle(person.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(isEditing ? "Done" : "Edit") {
                    if isEditing { try? modelContext.save() }
                    isEditing.toggle()
                }
            }
        }
    }
}
