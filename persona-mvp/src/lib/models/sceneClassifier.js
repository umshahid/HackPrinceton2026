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

  // Score each category by summing prediction probabilities for matching keywords
  const scores = { SCREEN: 0, OUTSIDE: 0, INSIDE: 0 }
  for (const pred of predictions) {
    const cat = matchCategory(pred.className)
    if (cat) scores[cat] += pred.probability
  }

  // Pick highest scoring category; default to INSIDE when nothing matches
  let bestCategory = 'INSIDE'
  let bestScore = 0
  for (const [cat, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score
      bestCategory = cat
    }
  }

  const topConfidence = predictions[0]?.probability ?? 0
  console.log(`[Scene] ${bestCategory} (score=${bestScore.toFixed(3)}) top="${predictions[0]?.className}" (${topConfidence.toFixed(3)})`)

  const screenWarning = consecutiveScreenMinutes >= 90

  return {
    label: bestCategory,
    confidence: bestScore,
    rawPredictions: predictions,
    screenWarning,
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
