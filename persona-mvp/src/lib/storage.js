import localforage from 'localforage'

// Configure the single localforage instance (uses IndexedDB by default)
localforage.config({
  name: 'persona-mvp',
  storeName: 'persona_store',
})

// ---------------------------------------------------------------------------
// Persons
// ---------------------------------------------------------------------------

export async function savePerson(person) {
  const key = `person:${person.id}`
  await localforage.setItem(key, person)
  return person
}

export async function getPersons() {
  const persons = []
  await localforage.iterate((value, key) => {
    if (key.startsWith('person:')) persons.push(value)
  })
  return persons
}

export async function updatePerson(id, changes) {
  const key = `person:${id}`
  const existing = await localforage.getItem(key)
  if (!existing) return null
  const updated = { ...existing, ...changes, id }
  await localforage.setItem(key, updated)
  return updated
}

export async function deletePerson(id) {
  await localforage.removeItem(`person:${id}`)
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

export async function saveInteraction(interaction) {
  const key = `interaction:${interaction.id}`
  await localforage.setItem(key, interaction)
  return interaction
}

export async function getInteractionsByPerson(personId) {
  const results = []
  await localforage.iterate((value, key) => {
    if (key.startsWith('interaction:') && value.personId === personId) {
      results.push(value)
    }
  })
  return results.sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
}

export async function getAllInteractions() {
  const results = []
  await localforage.iterate((value, key) => {
    if (key.startsWith('interaction:')) results.push(value)
  })
  return results.sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
}

// ---------------------------------------------------------------------------
// Meals
// ---------------------------------------------------------------------------

export async function saveMeal(meal) {
  const key = `meal:${meal.date}:${meal.id}`
  await localforage.setItem(key, meal)
  return meal
}

export async function getMealsByDate(dateStr) {
  const prefix = `meal:${dateStr}:`
  const meals = []
  await localforage.iterate((value, key) => {
    if (key.startsWith(prefix)) meals.push(value)
  })
  return meals
}

export async function deleteMeal(id) {
  // We need to find the key since it includes a date prefix
  let targetKey = null
  await localforage.iterate((value, key) => {
    if (key.startsWith('meal:') && key.endsWith(`:${id}`)) {
      targetKey = key
    }
  })
  if (targetKey) await localforage.removeItem(targetKey)
}

// ---------------------------------------------------------------------------
// Daily Metrics (OUTSIDE, INSIDE, SCREEN minutes)
// ---------------------------------------------------------------------------

export async function updateDailyMetrics(dateStr, category, minutesToAdd) {
  const key = `metrics:${dateStr}`
  const existing = (await localforage.getItem(key)) || {
    OUTSIDE: 0,
    INSIDE: 0,
    SCREEN: 0,
  }
  existing[category] = (existing[category] || 0) + minutesToAdd
  await localforage.setItem(key, existing)
  return existing
}

export async function getDailyMetrics(dateStr) {
  const key = `metrics:${dateStr}`
  return (await localforage.getItem(key)) || { OUTSIDE: 0, INSIDE: 0, SCREEN: 0 }
}

export async function getLast7DaysMetrics() {
  const results = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const metrics = await getDailyMetrics(dateStr)
    results.push({ date: dateStr, ...metrics })
  }
  return results
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export async function saveConsent(timestamp) {
  await localforage.setItem('consent', { accepted: true, timestamp })
}

export async function getConsent() {
  return localforage.getItem('consent')
}
