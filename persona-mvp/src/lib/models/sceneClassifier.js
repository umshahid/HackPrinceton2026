import * as mobilenet from '@tensorflow-models/mobilenet'

let model = null

const timeTotals = { OUTSIDE: 0, INSIDE: 0, SCREEN: 0 }
let consecutiveScreenMinutes = 0

const OUTSIDE_KEYWORDS = [
  'outdoor', 'sky', 'tree', 'park', 'street', 'grass', 'road',
  'garden', 'beach', 'mountain', 'forest'
]

const SCREEN_KEYWORDS = [
  'screen', 'monitor', 'television', 'laptop', 'computer', 'display', 'phone'
]

const INSIDE_KEYWORDS = [
  'room', 'office', 'kitchen', 'bedroom', 'living', 'wall', 'ceiling', 'indoor'
]

export async function loadSceneModel() {
  if (!model) {
    model = await mobilenet.load({ version: 2, alpha: 1.0 })
  }
  return model
}

function matchCategory(label) {
  const lower = label.toLowerCase()
  // SCREEN takes priority
  if (SCREEN_KEYWORDS.some((kw) => lower.includes(kw))) return 'SCREEN'
  if (OUTSIDE_KEYWORDS.some((kw) => lower.includes(kw))) return 'OUTSIDE'
  if (INSIDE_KEYWORDS.some((kw) => lower.includes(kw))) return 'INSIDE'
  return null
}

export async function classifyScene(imageElement) {
  const m = await loadSceneModel()
  const predictions = await m.classify(imageElement, 5)

  const top = predictions[0]

  if (top.probability < 0.60) {
    return {
      label: 'UNCERTAIN',
      confidence: top.probability,
      rawPredictions: predictions,
      screenWarning: false
    }
  }

  // Check all predictions for category keywords, prioritising higher-confidence ones
  let bestCategory = null
  let bestConfidence = 0

  for (const pred of predictions) {
    const cat = matchCategory(pred.className)
    if (cat && pred.probability > bestConfidence) {
      bestCategory = cat
      bestConfidence = pred.probability
    }
  }

  // Default to INSIDE when no keywords match but confidence is high enough
  if (!bestCategory) {
    bestCategory = 'INSIDE'
    bestConfidence = top.probability
  }

  const screenWarning = consecutiveScreenMinutes >= 90

  return {
    label: bestCategory,
    confidence: bestConfidence,
    rawPredictions: predictions,
    screenWarning
  }
}

export function updateTimeTotals(category, pollIntervalSeconds) {
  const minutes = pollIntervalSeconds / 60
  if (category === 'OUTSIDE' || category === 'INSIDE' || category === 'SCREEN') {
    timeTotals[category] += minutes
  }

  if (category === 'SCREEN') {
    consecutiveScreenMinutes += minutes
  } else {
    consecutiveScreenMinutes = 0
  }
}

export function getTimeTotals() {
  return { ...timeTotals }
}

export function resetTimeTotals() {
  timeTotals.OUTSIDE = 0
  timeTotals.INSIDE = 0
  timeTotals.SCREEN = 0
}

export function getConsecutiveScreenMinutes() {
  return consecutiveScreenMinutes
}

export function resetConsecutiveScreenMinutes() {
  consecutiveScreenMinutes = 0
}
