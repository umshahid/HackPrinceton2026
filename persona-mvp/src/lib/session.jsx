import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { updateDailyMetrics, saveInteraction, saveMeal } from './storage.js'
import { estimateMealNutrition, summarizeInteraction } from './geminiApi.js'

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
          console.log(`[Persona] Face: count=${faceResult.count}, consecutive=${faceConsecutiveCount.current}${faceResult.box ? `, box=${JSON.stringify(faceResult.box)}` : ''}`)
          if (faceResult.count > 0) {
            faceConsecutiveCount.current += 1
            // Publish face box for overlay rendering
            if (p.onFaceDetected) p.onFaceDetected(faceResult)
          } else {
            faceConsecutiveCount.current = 0
            if (p.onFaceDetected) p.onFaceDetected(null)
          }
        } catch (err) { console.warn('[Persona] Face error:', err) }
      }

      // 5. Interaction detection
      const faceReady = faceConsecutiveCount.current >= FACE_CONSECUTIVE_THRESHOLD
      const isSpeaking = p.speechActive
      console.log(`[Persona] Interaction check: faceReady=${faceReady} (${faceConsecutiveCount.current}/${FACE_CONSECUTIVE_THRESHOLD}), speaking=${isSpeaking}, activeInteraction=${!!currentInteraction.current}`)

      if (faceReady && isSpeaking && !currentInteraction.current) {
        currentInteraction.current = {
          id: uuidv4(),
          startTime: new Date().toISOString(),
        }
        if (p.startTranscription) p.startTranscription()
        pushPrompt({ type: 'INTERACTION_START', timestamp: new Date().toISOString() })
      }

      if (currentInteraction.current && !faceReady && !isSpeaking) {
        let finalTranscript = p.transcript || ''
        if (p.stopTranscription) {
          const t = p.stopTranscription()
          if (t) finalTranscript = t
        }

        const interaction = {
          ...currentInteraction.current,
          endTime: new Date().toISOString(),
          transcript: finalTranscript,
        }

        try {
          interaction.summary = await summarizeInteraction(finalTranscript)
        } catch {
          interaction.summary = {
            overview: 'Interaction completed.',
            key_topics: [],
            action_items: [],
            sentiment: 'neutral',
            duration_minutes: 0,
          }
        }

        await saveInteraction(interaction)
        pushPrompt({ type: 'INTERACTION_END', interaction, timestamp: new Date().toISOString() })
        currentInteraction.current = null
        faceConsecutiveCount.current = 0
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
    currentInteraction.current = null
    mealPendingRef.current = false

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onPollFrame(), 2000)
  }, [onPollFrame])

  const stopSession = useCallback(async () => {
    setState(SessionState.STOPPED)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (currentInteraction.current) {
      const p = window.__persona
      let finalTranscript = p?.transcript || ''
      if (p?.stopTranscription) {
        const t = p.stopTranscription()
        if (t) finalTranscript = t
      }

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
      } catch { /* keep default */ }

      await saveInteraction(interaction)
      currentInteraction.current = null
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
