import * as faceapi from '@vladmandic/face-api'
import { savePerson, getPersons } from '../storage.js'

let modelsLoaded = false
let knownPersons = []
let nextPersonId = 1

function euclideanDistance(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

// face-api standard threshold: distance < 0.5 = same person, > 0.5 = different
const MATCH_THRESHOLD = 0.5

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
  if (!descriptor) {
    console.error('[FaceDetector] matchOrCreatePerson called with null descriptor')
    throw new Error('descriptor is null')
  }
  console.log(`[FaceDetector] matchOrCreatePerson: descriptor length=${descriptor.length}, knownPersons=${knownPersons.length}`)

  let bestMatch = null
  let bestDistance = Infinity

  for (const person of knownPersons) {
    const distance = euclideanDistance(descriptor, person.descriptor)
    console.log(`[FaceDetector] vs person id=${person.id} name="${person.name}" distance=${distance.toFixed(4)}`)
    if (distance < bestDistance) {
      bestDistance = distance
      bestMatch = person
    }
  }

  console.log(`[FaceDetector] best match: id=${bestMatch?.id} distance=${bestDistance.toFixed(4)} threshold=${MATCH_THRESHOLD} → ${bestMatch && bestDistance < MATCH_THRESHOLD ? 'MATCHED' : 'NEW PERSON'}`)

  if (bestMatch && bestDistance < MATCH_THRESHOLD) {
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
