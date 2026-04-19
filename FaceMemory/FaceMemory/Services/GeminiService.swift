//
//  GeminiService.swift
//  FaceMemory
//
//  Wraps calls to the Google Gemini API for two jobs:
//    1. Generate a short visual description of a person from an image
//    2. Summarize a conversation transcript into key topics + summary
//
//  API key is read from Info.plist (GEMINI_API_KEY). For real deploys
//  you'd want this behind your own backend to avoid embedding the key
//  in the app bundle.
//
//  Gemini REST reference:
//  https://ai.google.dev/api (generateContent endpoint)
//

import Foundation
import UIKit

enum GeminiServiceError: Error {
    case missingAPIKey
    case imageEncodingFailed
    case requestFailed(String)
    case decodingFailed
}

struct ConversationSummary {
    let summary: String
    let keyTopics: [String]
}

final class GeminiService {

    static let shared = GeminiService()

    // Gemini 2.5 Flash is fast, cheap, and multimodal. Swap for
    // "gemini-2.5-pro" if you want higher quality at higher cost.
    private let model = "gemini-2.5-flash"
    private let apiVersion = "v1beta"

    private var endpoint: URL {
        URL(string: "https://generativelanguage.googleapis.com/\(apiVersion)/models/\(model):generateContent")!
    }

    private var apiKey: String? {
        Bundle.main.object(forInfoDictionaryKey: "GEMINI_API_KEY") as? String
    }

    // MARK: - Visual Description

    /// Given an image of a person, return a neutral 2-3 sentence
    /// description focused on stable features useful for memory recall.
    func describePerson(image: UIImage) async throws -> String {
        guard let apiKey = apiKey, !apiKey.isEmpty, !apiKey.contains("YOUR_KEY") else {
            throw GeminiServiceError.missingAPIKey
        }
        guard let jpegData = image.jpegData(compressionQuality: 0.85) else {
            throw GeminiServiceError.imageEncodingFailed
        }
        let base64 = jpegData.base64EncodedString()

        let prompt = """
        Briefly describe this person's appearance for memory-aid purposes. \
        Focus on stable features (hair color/style, build, notable facial \
        features, approximate age range, expression). Avoid temporary details \
        like exact outfit. 2-3 sentences, neutral and respectful tone. \
        Do not speculate about identity, ethnicity, or personal traits beyond \
        what is visually apparent.
        """

        let body: [String: Any] = [
            "contents": [[
                "role": "user",
                "parts": [
                    [
                        "inline_data": [
                            "mime_type": "image/jpeg",
                            "data": base64
                        ]
                    ],
                    ["text": prompt]
                ]
            ]],
            "generationConfig": [
                "temperature": 0.4,
                "maxOutputTokens": 300
            ]
        ]

        return try await extractText(from: try await post(body: body, apiKey: apiKey))
    }

    // MARK: - Conversation Summary

    /// Summarize a transcript into a short summary + 3-5 key topics.
    func summarizeConversation(transcript: String, personName: String) async throws -> ConversationSummary {
        guard let apiKey = apiKey, !apiKey.isEmpty, !apiKey.contains("YOUR_KEY") else {
            throw GeminiServiceError.missingAPIKey
        }

        let prompt = """
        Below is a transcript of a conversation with \(personName). \
        Summarize it into:
        1. A 2-3 sentence summary (focus on what was discussed and any \
           commitments or notable details worth remembering later)
        2. A list of 3-5 short key topic tags (1-3 words each)

        Return ONLY valid JSON in this exact format with no other text, \
        no markdown, no code fences:
        {"summary": "...", "topics": ["topic1", "topic2", "topic3"]}

        Transcript:
        \(transcript)
        """

        let body: [String: Any] = [
            "contents": [[
                "role": "user",
                "parts": [["text": prompt]]
            ]],
            "generationConfig": [
                "temperature": 0.3,
                "maxOutputTokens": 500,
                "responseMimeType": "application/json"
            ]
        ]

        let raw = try await extractText(from: try await post(body: body, apiKey: apiKey))

        // Strip markdown fences defensively in case responseMimeType is ignored
        let cleaned = raw
            .replacingOccurrences(of: "```json", with: "")
            .replacingOccurrences(of: "```", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard let data = cleaned.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let summary = json["summary"] as? String,
              let topics = json["topics"] as? [String] else {
            throw GeminiServiceError.decodingFailed
        }

        return ConversationSummary(summary: summary, keyTopics: topics)
    }

    // MARK: - HTTP Plumbing

    private func post(body: [String: Any], apiKey: String) async throws -> Data {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "x-goog-api-key")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 30

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let msg = String(data: data, encoding: .utf8) ?? "unknown error"
            throw GeminiServiceError.requestFailed(msg)
        }
        return data
    }

    /// Gemini's generateContent response shape:
    /// { "candidates": [ { "content": { "parts": [ {"text": "..."} ] } } ] }
    private func extractText(from data: Data) async throws -> String {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let candidates = json["candidates"] as? [[String: Any]],
              let first = candidates.first,
              let content = first["content"] as? [String: Any],
              let parts = content["parts"] as? [[String: Any]] else {
            throw GeminiServiceError.decodingFailed
        }

        let text = parts
            .compactMap { $0["text"] as? String }
            .joined(separator: "\n")

        guard !text.isEmpty else { throw GeminiServiceError.decodingFailed }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
