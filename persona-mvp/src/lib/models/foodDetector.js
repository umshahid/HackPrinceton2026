import * as mobilenet from '@tensorflow-models/mobilenet'

let model = null

const FOOD_KEYWORDS = [
  'food', 'dish', 'meal', 'salad', 'pizza', 'burger', 'pasta', 'soup',
  'fruit', 'vegetable', 'sandwich', 'rice', 'bread', 'dessert', 'coffee',
  'drink', 'plate', 'bowl', 'cup', 'egg', 'meat', 'chicken', 'fish',
  'cheese', 'cake', 'cookie', 'ice cream', 'hot dog', 'french fries',
  'sushi', 'taco', 'burrito'
]

export async function loadFoodModel() {
  if (!model) {
    model = await mobilenet.load({ version: 2, alpha: 1.0 })
  }
  return model
}

export function getFoodLabelsFromPredictions(predictions) {
  const foodLabels = []
  for (const pred of predictions) {
    const lower = pred.className.toLowerCase()
    if (FOOD_KEYWORDS.some((kw) => lower.includes(kw))) {
      foodLabels.push(pred.className)
    }
  }
  return foodLabels
}

export async function detectFoodPresence(imageElement) {
  const m = await loadFoodModel()
  const predictions = await m.classify(imageElement, 5)

  const topLabels = predictions.map((p) => p.className)

  let maxFoodConfidence = 0
  for (const pred of predictions) {
    const lower = pred.className.toLowerCase()
    if (FOOD_KEYWORDS.some((kw) => lower.includes(kw))) {
      if (pred.probability > maxFoodConfidence) {
        maxFoodConfidence = pred.probability
      }
    }
  }

  const isFoodPresent = maxFoodConfidence > 0.80

  return {
    isFoodPresent,
    topLabels,
    confidence: maxFoodConfidence
  }
}
