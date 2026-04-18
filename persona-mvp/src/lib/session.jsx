import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { updateDailyMetrics, saveInteraction, saveMeal } from './storage.js'
import { estimateMealNutrition, summarizeInteraction } from './geminiApi.js'
import { matchOrCreatePerson } from './models/faceDetector.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SessionState = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED',
}

const FOOD_CONSECUTIVE_THRESHOLD = 3
const FACE_CONSECUTIVE_THRESHOLD = 3
const FOOD_ABSENT_RESET = 5
const FACE_END_THRESHOLD = 8   // consecutive absent polls before ending an interaction
const SPEECH_END_THRESHOLD = 5 // consecutive silent polls before treating speech as done

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SessionContext = createContext(null)

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within a SessionProvider')
  return ctx
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function SessionProvider({ children }) {
  const [state, setState] = useState(SessionState.IDLE)
  const [pollInterval, setPollInterval] = useState(1)
  const [sessionStartTime, setSessionStartTime] = useState(null)
  const [currentScene, setCurrentScene] = useState(null)
  const [promptQueue, setPromptQueue] = useState([])

  const stateRef = useRef(state)
  const pollIntervalRef = useRef(pollInterval)
  const timerRef = useRef(null)
  const foodConsecutiveCount = useRef(0)
  const foodAbsentCount = useRef(0)
  const faceConsecutiveCount = useRef(0)
  const currentInteraction = useRef(null)
  const mealPendingRef = useRef(false)
  const lastFaceDescriptorRef = useRef(null)
  const lastFaceThumbnailRef = useRef(null)
  const faceAbsentCount = useRef(0)
  const speechAbsentCount = useRef(0)

  useEffect(() => { stateRef.current = state }, [state])
  useEffect(() => { pollIntervalRef.current = pollInterval }, [pollInterval])

  // Prompt queue
  const pushPrompt = useCallback((prompt) => {
    setPromptQueue((q) => [...q, { id: uuidv4(), ...prompt }])
  }, [])

  const dismissPrompt = useCallback(() => {
    setPromptQueue((q) => q.slice(1))
  }, [])

  const activePrompt = promptQueue[0] || null

  const todayStr = () => new Date().toISOString().slice(0, 10)

  // ---------------------------------------------------------------------------
  // Poll frame — reads detection functions from window.__persona
  // ---------------------------------------------------------------------------
  const onPollFrame = useCallback(async () => {
    if (stateRef.current !== SessionState.RUNNING) return

    const p = window.__persona
    if (!p) { schedulePoll(); return }

    try {
      // 1. Capture frame
      const frame = p.captureFrame ? await p.captureFrame() : null
      if (!frame) {
        console.warn('[Persona] captureFrame returned null — camera not ready?')
        schedulePoll()
        return
      }

      const { imageData } = frame
      console.log(`[Persona] Poll: frame captured ${imageData.width}x${imageData.height}`)

      // 2. Scene classification
      if (p.classifyScene) {
        try {
          const scene = await p.classifyScene(imageData)
          console.log(`[Persona] Scene: ${scene}`)
          setCurrentScene(scene)
          const validCategories = ['OUTSIDE', 'INSIDE', 'SCREEN']
          if (validCategories.includes(scene)) {
            const minutesToAdd = pollIntervalRef.current / 60
            await updateDailyMetrics(todayStr(), scene, minutesToAdd)
          }
        } catch (err) { console.warn('[Persona] Scene error:', err) }
      }

      // 3. Food detection
      if (p.detectFood) {
        try {
          const foodResult = await p.detectFood(imageData)
          console.log(`[Persona] Food: detected=${foodResult.detected}, labels=[${(foodResult.labels || []).slice(0, 3).join(', ')}], confidence=${foodResult.confidence?.toFixed(3)}`)
          if (foodResult.detected) {
            foodConsecutiveCount.current += 1
            foodAbsentCount.current = 0

            if (foodConsecutiveCount.current >= FOOD_CONSECUTIVE_THRESHOLD && !mealPendingRef.current) {
              mealPendingRef.current = true
              pushPrompt({
                type: 'MEAL_DETECTED',
                labels: foodResult.labels || [],
                timestamp: new Date().toISOString(),
              })
              try {
                const nutrition = await estimateMealNutrition(
                  foodResult.labels || [],
                  'medium',
                  guessMealTime()
                )
                const meal = {
                  id: uuidv4(),
                  date: todayStr(),
                  timestamp: new Date().toISOString(),
                  snapshotBase64: null,
                  mealName: nutrition.meal_name || 'Detected Meal',
                  items: nutrition.items || [],
                  totalCalories: nutrition.total_calories || 0,
                  macros: {
                    protein: nutrition.total_protein_g || 0,
                    carbs: nutrition.total_carbs_g || 0,
                    fat: nutrition.total_fat_g || 0,
                  },
                  confidence: nutrition.confidence || 'medium',
                  labels: foodResult.labels,
                }
                await saveMeal(meal)
              } catch (err) {
                console.warn('Meal nutrition error:', err)
                // Save with error flag
                const meal = {
                  id: uuidv4(),
                  date: todayStr(),
                  timestamp: new Date().toISOString(),
                  mealName: (foodResult.labels || []).join(', ') || 'Unknown Meal',
                  items: [],
                  totalCalories: 0,
                  macros: { protein: 0, carbs: 0, fat: 0 },
                  confidence: 'low',
                  claudeError: true,
                  labels: foodResult.labels,
                }
                await saveMeal(meal)
              }
              foodConsecutiveCount.current = 0
            }
          } else {
            foodAbsentCount.current += 1
            if (foodAbsentCount.current >= FOOD_ABSENT_RESET) {
              foodConsecutiveCount.current = 0
              mealPendingRef.current = false
            }
          }
        } catch (err) { console.warn('Food error:', err) }
      }

      // 4. Face detection
      if (p.detectFaces) {
        try {
          const faceResult = await p.detectFaces(imageData)
          if (faceResult.count > 0) {
            faceConsecutiveCount.current += 1
            faceAbsentCount.current = 0
            if (faceResult.descriptor) {
              lastFaceDescriptorRef.current = faceResult.descriptor
              lastFaceThumbnailRef.current = faceResult.thumbnailBase64 || null
            }
            console.log(`[Persona] Face: DETECTED consecutive=${faceConsecutiveCount.current} hasDescriptor=${!!faceResult.descriptor} hasThumbnail=${!!faceResult.thumbnailBase64}`)
            if (p.onFaceDetected) p.onFaceDetected(faceResult)
          } else {
            faceConsecutiveCount.current = 0
            faceAbsentCount.current += 1
            console.log(`[Persona] Face: ABSENT absent=${faceAbsentCount.current}/${FACE_END_THRESHOLD}`)
            if (p.onFaceDetected) p.onFaceDetected(null)
          }
        } catch (err) { console.warn('[Persona] Face error:', err) }
      } else {
        console.warn('[Persona] p.detectFaces not available')
      }

      // 5. Interaction detection
      const faceReady = faceConsecutiveCount.current >= FACE_CONSECUTIVE_THRESHOLD
      const isSpeaking = p.speechActive

      if (isSpeaking === undefined) {
        console.warn('[Persona] p.speechActive is undefined — audio monitoring may not be running')
      }

      if (isSpeaking) {
        speechAbsentCount.current = 0
      } else {
        speechAbsentCount.current += 1
      }

      const faceGone = faceAbsentCount.current >= FACE_END_THRESHOLD
      const speechGone = speechAbsentCount.current >= SPEECH_END_THRESHOLD
      console.log(`[Persona] Interaction: faceReady=${faceReady}(${faceConsecutiveCount.current}/${FACE_CONSECUTIVE_THRESHOLD}) faceGone=${faceGone}(${faceAbsentCount.current}/${FACE_END_THRESHOLD}) isSpeaking=${isSpeaking} speechGone=${speechGone}(${speechAbsentCount.current}/${SPEECH_END_THRESHOLD}) active=${!!currentInteraction.current}`)

      if (faceReady && isSpeaking && !currentInteraction.current) {
        console.log('[Persona] Interaction START — face ready + speaking detected')
        currentInteraction.current = {
          id: uuidv4(),
          startTime: new Date().toISOString(),
          _descriptor: lastFaceDescriptorRef.current,
          _thumbnail: lastFaceThumbnailRef.current,
        }
        console.log(`[Persona] Interaction created id=${currentInteraction.current.id} hasDescriptor=${!!currentInteraction.current._descriptor}`)
        if (p.startTranscription) {
          p.startTranscription()
          console.log('[Persona] startTranscription called')
        } else {
          console.warn('[Persona] p.startTranscription not available — transcript will be empty')
        }
      }

      if (currentInteraction.current) {
        const currentTranscript = p.transcript || ''
        console.log(`[Persona] Active interaction transcript so far: ${currentTranscript.length} chars — "${currentTranscript.slice(0, 80)}${currentTranscript.length > 80 ? '…' : ''}"`)
      }

      if (currentInteraction.current && faceGone && speechGone) {
        console.log('[Persona] Interaction END — face + speech both gone, saving...')
        let finalTranscript = p.transcript || ''
        console.log(`[Persona] p.transcript at end: ${finalTranscript.length} chars`)
        if (p.stopTranscription) {
          const t = p.stopTranscription()
          console.log(`[Persona] stopTranscription() returned: ${(t || '').length} chars — "${(t || '').slice(0, 80)}"`)
          if (t) finalTranscript = t
        } else {
          console.warn('[Persona] p.stopTranscription not available')
        }
        console.log(`[Persona] Final transcript (${finalTranscript.length} chars): "${finalTranscript.slice(0, 120)}"`)

        const interaction = {
          ...currentInteraction.current,
          endTime: new Date().toISOString(),
          transcript: finalTranscript,
        }

        try {
          console.log('[Persona] Calling summarizeInteraction...')
          interaction.summary = await summarizeInteraction(finalTranscript)
          console.log('[Persona] summarizeInteraction success:', JSON.stringify(interaction.summary).slice(0, 120))
        } catch (err) {
          console.error('[Persona] summarizeInteraction failed:', err)
          interaction.summary = {
            overview: 'Interaction completed.',
            key_topics: [],
            action_items: [],
            sentiment: 'neutral',
            duration_minutes: 0,
          }
        }

        if (interaction._descriptor) {
          try {
            const { person } = await matchOrCreatePerson(interaction._descriptor, interaction._thumbnail)
            interaction.personId = person.id
            console.log(`[Persona] Matched/created person id=${person.id}`)
          } catch (err) {
            console.warn('[Persona] matchOrCreatePerson failed:', err)
          }
        }
        delete interaction._descriptor
        delete interaction._thumbnail

        try {
          console.log(`[Persona] Saving interaction id=${interaction.id} personId=${interaction.personId} transcriptLen=${interaction.transcript.length}`)
          await saveInteraction(interaction)
          console.log('[Persona] saveInteraction SUCCESS')
        } catch (err) {
          console.error('[Persona] saveInteraction FAILED:', err)
        }
        currentInteraction.current = null
        faceConsecutiveCount.current = 0
        faceAbsentCount.current = 0
        speechAbsentCount.current = 0
      }
    } catch (err) {
      console.error('Poll frame error:', err)
    }

    schedulePoll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushPrompt])

  const schedulePoll = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onPollFrame()
    }, pollIntervalRef.current * 1000)
  }, [onPollFrame])

  // Session controls
  const startSession = useCallback(() => {
    setState(SessionState.RUNNING)
    setSessionStartTime(new Date().toISOString())
    setPromptQueue([])
    foodConsecutiveCount.current = 0
    foodAbsentCount.current = 0
    faceConsecutiveCount.current = 0
    faceAbsentCount.current = 0
    speechAbsentCount.current = 0
    currentInteraction.current = null
    mealPendingRef.current = false

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onPollFrame(), 2000)
  }, [onPollFrame])

  const stopSession = useCallback(async () => {
    console.log('[Persona] stopSession called — currentInteraction exists:', !!currentInteraction.current)
    setState(SessionState.STOPPED)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (currentInteraction.current) {
      const p = window.__persona
      console.log('[Persona] stopSession: saving in-progress interaction id=', currentInteraction.current.id)
      let finalTranscript = p?.transcript || ''
      console.log(`[Persona] stopSession: p.transcript=${finalTranscript.length} chars`)
      if (p?.stopTranscription) {
        const t = p.stopTranscription()
        console.log(`[Persona] stopSession: stopTranscription() returned ${(t || '').length} chars`)
        if (t) finalTranscript = t
      } else {
        console.warn('[Persona] stopSession: p.stopTranscription not available')
      }
      console.log(`[Persona] stopSession: finalTranscript ${finalTranscript.length} chars — "${finalTranscript.slice(0, 120)}"`)

      const interaction = {
        ...currentInteraction.current,
        endTime: new Date().toISOString(),
        transcript: finalTranscript,
        summary: {
          overview: 'Session ended during interaction.',
          key_topics: [],
          action_items: [],
          sentiment: 'neutral',
          duration_minutes: 0,
        },
      }

      try {
        interaction.summary = await summarizeInteraction(finalTranscript)
        console.log('[Persona] stopSession: summarizeInteraction success')
      } catch (err) {
        console.error('[Persona] stopSession: summarizeInteraction failed:', err)
      }

      if (interaction._descriptor) {
        try {
          const { person } = await matchOrCreatePerson(interaction._descriptor, interaction._thumbnail)
          interaction.personId = person.id
          console.log('[Persona] stopSession: matched person id=', person.id)
        } catch (err) {
          console.warn('[Persona] stopSession: matchOrCreatePerson failed:', err)
        }
      }
      delete interaction._descriptor
      delete interaction._thumbnail

      try {
        console.log(`[Persona] stopSession: saving interaction id=${interaction.id} transcriptLen=${interaction.transcript.length}`)
        await saveInteraction(interaction)
        console.log('[Persona] stopSession: saveInteraction SUCCESS')
      } catch (err) {
        console.error('[Persona] stopSession: saveInteraction FAILED:', err)
      }
      currentInteraction.current = null
    } else {
      console.warn('[Persona] stopSession: no active interaction to save — was the interaction started? Check face/speech detection logs above.')
    }
  }, [])

  const pauseSession = useCallback(() => {
    setState(SessionState.PAUSED)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  const value = {
    state,
    startSession,
    stopSession,
    pauseSession,
    pollInterval,
    setPollInterval,
    sessionStartTime,
    currentScene,
    promptQueue,
    dismissPrompt,
    activePrompt,
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guessMealTime() {
  const hour = new Date().getHours()
  if (hour < 10) return 'breakfast'
  if (hour < 14) return 'lunch'
  if (hour < 17) return 'snack'
  return 'dinner'
}
