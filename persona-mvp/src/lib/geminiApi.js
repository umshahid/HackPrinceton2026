const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent'

/**
 * Call the Gemini REST API with a system instruction and user message.
 * Expects the response to be JSON (via responseMimeType).
 */
export async function callGemini({ systemInstruction, userMessage, maxTokens = 1000 }) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY is not set')

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${errBody}`)
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const clean = text.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

/**
 * Estimate nutritional info for a detected meal using Gemini.
 * @param {string[]} topLabels - Image classification labels (e.g. ["pizza", "plate"])
 * @param {string} portionSize - e.g. "medium", "large"
 * @param {string} mealTime - e.g. "breakfast", "lunch", "dinner", "snack"
 * @returns Nutrition estimate object
 */
export async function estimateMealNutrition(topLabels, portionSize = 'medium', mealTime = 'lunch') {
  const systemInstruction = `You are a nutrition estimation assistant. Given food classification labels from an image, a portion size hint, and the meal time, estimate the nutritional content. Be reasonable with estimates — it's okay to be approximate. Always respond with valid JSON matching the exact schema requested.`

  const userMessage = `The camera detected these food-related labels: ${JSON.stringify(topLabels)}.
Portion size: ${portionSize}.
Meal time: ${mealTime}.

Return a JSON object with this exact schema:
{
  "meal_name": "string — a short descriptive name for this meal",
  "items": [
    {
      "name": "string",
      "quantity": "string (e.g. '1 slice', '1 cup')",
      "calories": number,
      "protein_g": number,
      "carbs_g": number,
      "fat_g": number
    }
  ],
  "total_calories": number,
  "total_protein_g": number,
  "total_carbs_g": number,
  "total_fat_g": number,
  "confidence": "low | medium | high"
}`

  return callGemini({ systemInstruction, userMessage, maxTokens: 1000 })
}

/**
 * Summarize a conversation transcript using Gemini.
 * @param {string} transcript - Full text transcript of the interaction
 * @returns Summary object
 */
export async function summarizeInteraction(transcript) {
  // Skip API call for very short transcripts
  if (!transcript || transcript.trim().split(/\s+/).length < 10) {
    return {
      overview: 'Brief interaction with minimal conversation.',
      key_topics: [],
      action_items: [],
      sentiment: 'neutral',
      duration_minutes: 0,
    }
  }

  const systemInstruction = `You are a conversation summarization assistant. Given a transcript of an in-person interaction, produce a concise summary. Always respond with valid JSON matching the exact schema requested.`

  const userMessage = `Summarize the following conversation transcript:

"""
${transcript}
"""

Return a JSON object with this exact schema:
{
  "overview": "string — one sentence summary of the conversation",
  "key_topics": ["string", "string"],
  "action_items": ["string"],
  "sentiment": "positive | neutral | tense",
  "duration_minutes": number
}`

  return callGemini({ systemInstruction, userMessage, maxTokens: 800 })
}

/**
 * Extract the person's name if they introduce themselves in the transcript.
 * Returns the name string, or null if no name was found.
 * @param {string} transcript
 * @returns {Promise<string|null>}
 */
export async function extractPersonName(transcript) {
  if (!transcript || transcript.trim().length < 5) return null

  const systemInstruction = `You are an assistant that extracts a person's name from a conversation transcript. Only return a name if the person explicitly introduces themselves (e.g. "I'm Jason", "My name is Sarah", "Call me Mike"). If no clear self-introduction is present, return null. Always respond with valid JSON.`

  const userMessage = `Does the person in this transcript introduce themselves by name?

"""
${transcript}
"""

Return a JSON object: { "name": "FirstName" } if a name was found, or { "name": null } if not.`

  const result = await callGemini({ systemInstruction, userMessage, maxTokens: 50 })
  return result?.name || null
}
