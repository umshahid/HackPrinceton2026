import * as faceapi from 'face-api.js'
import { savePerson, getPersons } from '../storage.js'

let modelsLoaded = false
let knownPersons = []
let nextPersonId = 1

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export async function loadFaceModels() {
  if (modelsLoaded) return
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('/models')
  ])
  modelsLoaded = true
}

export async function detectFace(imageElement) {
  if (!modelsLoaded) {
    await loadFaceModels()
  }

  const detection = await faceapi
    .detectSingleFace(imageElement, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor()

  if (!detection) {
    return { detected: false, descriptor: null, box: null }
  }

  const { x, y, width, height } = detection.detection.box
  return {
    detected: true,
    descriptor: detection.descriptor,
    box: { x, y, width, height }
  }
}

export function cropFaceThumbnail(imageElement, box) {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  ctx.drawImage(
    imageElement,
    box.x, box.y, box.width, box.height,
    0, 0, 96, 96
  )
  return canvas.toDataURL('image/jpeg', 0.8)
}

export async function loadPersonsFromStorage() {
  const stored = await getPersons()
  if (stored && stored.length > 0) {
    knownPersons = stored.map((p) => ({
      ...p,
      descriptor: new Float32Array(p.descriptor)
    }))
    const maxId = Math.max(...knownPersons.map((p) => p.id || 0))
    nextPersonId = maxId + 1
  }
}

export async function matchOrCreatePerson(descriptor, thumbnailBase64) {
  let bestMatch = null
  let bestSimilarity = -1

  for (const person of knownPersons) {
    const similarity = cosineSimilarity(descriptor, person.descriptor)
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity
      bestMatch = person
    }
  }

  if (bestMatch && bestSimilarity > 0.85) {
    return { person: bestMatch, isNew: false }
  }

  const newPerson = {
    id: nextPersonId++,
    name: `Person ${nextPersonId - 1}`,
    descriptor: Array.from(descriptor),
    thumbnail: thumbnailBase64,
    createdAt: Date.now()
  }

  knownPersons.push({
    ...newPerson,
    descriptor: new Float32Array(descriptor)
  })

  await savePerson(newPerson)

  return { person: newPerson, isNew: true }
}
