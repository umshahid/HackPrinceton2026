import { useState, useEffect, useCallback } from 'react'
import { getMealsByDate, deleteMeal } from '../../lib/storage'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

const styles = {
  container: {
    padding: 16,
    minHeight: '100%',
    background: 'var(--surface)',
  },
  sectionTitle: {
    color: '#191c18',
    fontSize: 16,
    fontWeight: 600,
    fontFamily: 'Manrope, sans-serif',
    marginBottom: 12,
    marginTop: 20,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '1.5rem',
    padding: 16,
    marginBottom: 12,
    boxShadow: '0 4px 40px rgba(85,98,77,0.06)',
  },
  calorieHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  calorieTotal: {
    color: '#191c18',
    fontSize: 28,
    fontWeight: 700,
    fontFamily: 'Manrope, sans-serif',
  },
  calorieTarget: {
    color: '#444841',
    fontSize: 13,
  },
  progressBarOuter: {
    height: 8,
    backgroundColor: '#ecefe8',
    borderRadius: 9999,
    overflow: 'hidden',
  },
  progressBarInner: {
    height: '100%',
    borderRadius: 9999,
    transition: 'width 400ms ease-in-out',
  },
  targetInput: {
    width: 60,
    padding: '3px 6px',
    borderRadius: 6,
    border: '1px solid rgba(197,200,190,0.5)',
    backgroundColor: '#f2f4ed',
    color: '#191c18',
    fontSize: 12,
    textAlign: 'right',
    outline: 'none',
    marginLeft: 6,
  },
  mealCard: {
    backgroundColor: '#ffffff',
    borderRadius: '1.5rem',
    padding: 14,
    marginBottom: 10,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    transition: 'background-color 400ms ease-in-out',
    boxShadow: '0 4px 40px rgba(85,98,77,0.06)',
  },
  mealThumb: {
    width: 48,
    height: 48,
    borderRadius: '0.75rem',
    backgroundColor: '#ecefe8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    overflow: 'hidden',
    flexShrink: 0,
  },
  mealInfo: {
    flex: 1,
    minWidth: 0,
  },
  mealName: {
    color: '#191c18',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: 'Manrope, sans-serif',
    marginBottom: 2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  mealMeta: {
    color: '#444841',
    fontSize: 12,
  },
  mealCal: {
    color: '#55624d',
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
    fontFamily: 'Manrope, sans-serif',
  },
  detailHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: '#55624d',
    fontSize: 14,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
    fontWeight: 600,
  },
  detailTitle: {
    color: '#191c18',
    fontSize: 18,
    fontWeight: 700,
    fontFamily: 'Manrope, sans-serif',
    flex: 1,
  },
  deleteBtn: {
    background: 'none',
    border: '1px solid rgba(220,38,38,0.25)',
    color: '#dc2626',
    fontSize: 12,
    cursor: 'pointer',
    padding: '4px 12px',
    borderRadius: 9999,
  },
  editBtn: {
    background: 'none',
    border: '1px solid rgba(197,200,190,0.7)',
    color: '#444841',
    fontSize: 12,
    cursor: 'pointer',
    padding: '4px 12px',
    borderRadius: 9999,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    color: '#444841',
    fontWeight: 500,
    padding: '6px 8px',
    fontSize: '0.625rem',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  td: {
    color: '#191c18',
    padding: '8px 8px',
  },
  confidenceBadge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 9999,
    fontSize: 11,
    fontWeight: 600,
  },
  editInput: {
    backgroundColor: '#f2f4ed',
    border: '1px solid #55624d',
    color: '#191c18',
    fontSize: 13,
    padding: '4px 8px',
    borderRadius: '0.75rem',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  chartContainer: {
    height: 220,
    marginTop: 8,
  },
  emptyState: {
    color: '#444841',
    textAlign: 'center',
    padding: '60px 20px',
    fontSize: 14,
    lineHeight: 1.6,
  },
  disclaimer: {
    color: '#9ca3af',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 24,
    padding: '12px 0',
  },
  timestamp: {
    color: '#444841',
    fontSize: 12,
    marginBottom: 12,
  },
}

function formatTime(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatCalories(n) {
  return (n || 0).toLocaleString()
}

function getConfidenceStyle(confidence) {
  if (!confidence) return { backgroundColor: '#ecefe8', color: '#444841' }
  const c = confidence.toLowerCase()
  if (c === 'high') return { backgroundColor: '#d9e7cd', color: '#55624d' }
  if (c === 'medium') return { backgroundColor: '#fef3c7', color: '#92400e' }
  return { backgroundColor: '#fee2e2', color: '#dc2626' }
}

function getProgressColor(pct) {
  if (pct > 100) return '#dc2626'
  if (pct >= 80) return '#f59e0b'
  return '#55624d'
}

function getDayName(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}

const TOOLTIP_STYLE = {
  backgroundColor: '#ffffff',
  borderRadius: 8,
  color: '#191c18',
  fontSize: 12,
  boxShadow: '0 4px 20px rgba(85,98,77,0.10)',
}

// Static helper for use outside the component (e.g., in loadData)
function getMealCaloriesStatic(meal) {
  return meal.totalCalories || meal.nutrition?.totalCalories || meal.nutrition?.calories || 0
}

export default function MealsTab() {
  const [meals, setMeals] = useState([])
  const [selectedMeal, setSelectedMeal] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editFields, setEditFields] = useState({})
  const [weekData, setWeekData] = useState([])
  const [calorieTarget, setCalorieTarget] = useState(() => {
    const stored = localStorage.getItem('persona_calorieTarget')
    return stored ? Number(stored) : 2000
  })

  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()

  const loadData = useCallback(async () => {
    const todayMeals = await getMealsByDate(todayStr)
    setMeals(todayMeals.sort((a, b) => new Date(a.timestamp || a.time) - new Date(b.timestamp || b.time)))

    // Load 7 days of meal data
    const days = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      const dayMeals = await getMealsByDate(ds)
      const totalCal = dayMeals.reduce((sum, m) => sum + getMealCaloriesStatic(m), 0)
      days.push({ date: ds, day: getDayName(ds), calories: totalCal })
    }
    setWeekData(days)
  }, [todayStr])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    localStorage.setItem('persona_calorieTarget', String(calorieTarget))
  }, [calorieTarget])

  const totalCalories = meals.reduce((sum, m) => sum + getMealCaloriesStatic(m), 0)

  const pct = calorieTarget > 0 ? (totalCalories / calorieTarget) * 100 : 0

  const handleDelete = async (id) => {
    await deleteMeal(id)
    setSelectedMeal(null)
    await loadData()
  }

  const getMealDisplayName = (meal) => {
    if (meal.mealName) return meal.mealName
    if (meal.name) return meal.name
    if (meal.labels && meal.labels.length > 0) return meal.labels.join(', ')
    return 'Meal'
  }

  const getMealCalories = (meal) => {
    return meal.totalCalories || meal.nutrition?.totalCalories || meal.nutrition?.calories || 0
  }

  const getMealItems = (meal) => {
    return meal.items || meal.nutrition?.items || []
  }

  // Detail view
  if (selectedMeal) {
    const meal = selectedMeal
    const items = getMealItems(meal)
    const confidence = meal.nutrition?.confidence || meal.confidence || null

    return (
      <div style={styles.container}>
        <div style={styles.detailHeader}>
          <button style={styles.backBtn} onClick={() => { setSelectedMeal(null); setEditing(false) }}>
            &#8592; Back
          </button>
          {editing ? (
            <input
              style={{ ...styles.editInput, flex: 1, fontSize: 18, fontWeight: 700 }}
              value={editFields.name || ''}
              onChange={(e) => setEditFields({ ...editFields, name: e.target.value })}
            />
          ) : (
            <span style={styles.detailTitle}>{getMealDisplayName(meal)}</span>
          )}
          <button
            style={styles.editBtn}
            onClick={() => {
              if (editing) {
                // Save edits (local only for now)
                setSelectedMeal({
                  ...meal,
                  name: editFields.name,
                  nutrition: {
                    ...meal.nutrition,
                    totalCalories: Number(editFields.calories) || getMealCalories(meal),
                  },
                })
                setEditing(false)
              } else {
                setEditFields({
                  name: getMealDisplayName(meal),
                  calories: getMealCalories(meal),
                })
                setEditing(true)
              }
            }}
          >
            {editing ? 'Save' : 'Edit'}
          </button>
          <button style={styles.deleteBtn} onClick={() => handleDelete(meal.id)}>
            Delete
          </button>
        </div>

        <div style={styles.timestamp}>
          {formatTime(meal.timestamp || meal.time)}
        </div>

        {confidence && (
          <div style={{ marginBottom: 12 }}>
            <span style={{ ...styles.confidenceBadge, ...getConfidenceStyle(confidence) }}>
              {confidence} confidence
            </span>
          </div>
        )}

        {editing ? (
          <div style={styles.card}>
            <div style={{ marginBottom: 10 }}>
              <label style={{ color: '#444841', fontSize: 12, display: 'block', marginBottom: 4 }}>Calories</label>
              <input
                style={styles.editInput}
                type="number"
                value={editFields.calories || ''}
                onChange={(e) => setEditFields({ ...editFields, calories: e.target.value })}
              />
            </div>
          </div>
        ) : (
          <div style={styles.card}>
            <div style={{ color: '#55624d', fontSize: 28, fontWeight: 700, marginBottom: 12, fontFamily: 'Manrope, sans-serif' }}>
              {formatCalories(getMealCalories(meal))} kcal
            </div>

            {items.length > 0 && (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Qty</th>
                    <th style={styles.th}>Cal</th>
                    <th style={styles.th}>P</th>
                    <th style={styles.th}>C</th>
                    <th style={styles.th}>F</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i}>
                      <td style={styles.td}>{item.name || item.label || '-'}</td>
                      <td style={styles.td}>{item.quantity || item.qty || '-'}</td>
                      <td style={styles.td}>{item.calories || item.cal || '-'}</td>
                      <td style={styles.td}>{item.protein_g || item.protein || '-'}</td>
                      <td style={styles.td}>{item.carbs_g || item.carbs || '-'}</td>
                      <td style={styles.td}>{item.fat_g || item.fat || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {items.length === 0 && (
              <div style={{ color: '#444841', fontSize: 13 }}>
                No item breakdown available.
              </div>
            )}
          </div>
        )}

        <div style={styles.disclaimer}>
          Calorie counts are estimates.
        </div>
      </div>
    )
  }

  // List view
  return (
    <div style={styles.container}>
      {/* Calorie summary */}
      <div style={styles.card}>
        <div style={styles.calorieHeader}>
          <span style={styles.calorieTotal}>
            {formatCalories(totalCalories)}
          </span>
          <span style={styles.calorieTarget}>
            / {formatCalories(calorieTarget)} kcal
            <input
              style={styles.targetInput}
              type="number"
              min={0}
              value={calorieTarget}
              onChange={(e) => setCalorieTarget(Math.max(0, Number(e.target.value)))}
              title="Daily target"
            />
          </span>
        </div>
        <div style={styles.progressBarOuter}>
          <div
            style={{
              ...styles.progressBarInner,
              width: `${Math.min(pct, 100)}%`,
              backgroundColor: getProgressColor(pct),
            }}
          />
        </div>
      </div>

      {/* Meal list */}
      <div style={styles.sectionTitle}>Today's Meals</div>
      {meals.length === 0 ? (
        <div style={styles.emptyState}>
          No meals logged today. Start a session to track meals.
        </div>
      ) : (
        meals.map((meal) => (
          <div
            key={meal.id}
            style={styles.mealCard}
            onClick={() => setSelectedMeal(meal)}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f2f4ed')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
          >
            <div style={styles.mealThumb}>
              {meal.snapshot ? (
                <img
                  src={meal.snapshot}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                '\u{1F372}'
              )}
            </div>
            <div style={styles.mealInfo}>
              <div style={styles.mealName}>{getMealDisplayName(meal)}</div>
              <div style={styles.mealMeta}>{formatTime(meal.timestamp || meal.time)}</div>
            </div>
            <div style={styles.mealCal}>{formatCalories(getMealCalories(meal))} kcal</div>
          </div>
        ))
      )}

      {/* 7-day chart */}
      <div style={styles.sectionTitle}>Last 7 Days</div>
      <div style={{ ...styles.card, ...styles.chartContainer }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={weekData}>
            <XAxis
              dataKey="day"
              tick={{ fill: '#444841', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#444841', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(val) => [`${formatCalories(val)} kcal`, 'Calories']}
            />
            <ReferenceLine
              y={calorieTarget}
              stroke="#f87171"
              strokeDasharray="4 4"
              strokeWidth={1.5}
            />
            <Bar dataKey="calories" fill="#98a68e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={styles.disclaimer}>
        Calorie counts are estimates.
      </div>
    </div>
  )
}
