import { useState, useEffect, useCallback } from 'react'
import { getMealsByDate, deleteMeal } from '../../lib/storage'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

const styles = {
  container: {
    padding: 16,
    minHeight: '100%',
  },
  sectionTitle: {
    color: '#e8e8ed',
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 12,
    marginTop: 20,
  },
  card: {
    backgroundColor: '#16161f',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    border: '1px solid #2a2a3a',
  },
  calorieHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  calorieTotal: {
    color: '#e8e8ed',
    fontSize: 24,
    fontWeight: 700,
  },
  calorieTarget: {
    color: '#8888a0',
    fontSize: 14,
  },
  progressBarOuter: {
    height: 10,
    backgroundColor: '#2a2a3a',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressBarInner: {
    height: '100%',
    borderRadius: 5,
    transition: 'width 0.3s ease',
  },
  targetInput: {
    width: 60,
    padding: '3px 6px',
    borderRadius: 6,
    border: '1px solid #2a2a3a',
    backgroundColor: '#0a0a0f',
    color: '#e8e8ed',
    fontSize: 12,
    textAlign: 'right',
    outline: 'none',
    marginLeft: 6,
  },
  mealCard: {
    backgroundColor: '#16161f',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    border: '1px solid #2a2a3a',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    transition: 'background-color 0.15s',
  },
  mealThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#2a2a3a',
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
    color: '#e8e8ed',
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  mealMeta: {
    color: '#8888a0',
    fontSize: 12,
  },
  mealCal: {
    color: '#fbbf24',
    fontSize: 14,
    fontWeight: 600,
    flexShrink: 0,
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
    color: '#60a5fa',
    fontSize: 14,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
  },
  detailTitle: {
    color: '#e8e8ed',
    fontSize: 18,
    fontWeight: 700,
    flex: 1,
  },
  deleteBtn: {
    background: 'none',
    border: '1px solid #f8717140',
    color: '#f87171',
    fontSize: 12,
    cursor: 'pointer',
    padding: '4px 10px',
    borderRadius: 6,
  },
  editBtn: {
    background: 'none',
    border: '1px solid #2a2a3a',
    color: '#8888a0',
    fontSize: 12,
    cursor: 'pointer',
    padding: '4px 10px',
    borderRadius: 6,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    color: '#8888a0',
    fontWeight: 500,
    padding: '6px 8px',
    borderBottom: '1px solid #2a2a3a',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  td: {
    color: '#e8e8ed',
    padding: '8px 8px',
    borderBottom: '1px solid #2a2a3a10',
  },
  confidenceBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
  },
  editInput: {
    backgroundColor: '#0a0a0f',
    border: '1px solid #60a5fa',
    color: '#e8e8ed',
    fontSize: 13,
    padding: '4px 6px',
    borderRadius: 6,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  chartContainer: {
    height: 220,
    marginTop: 8,
  },
  emptyState: {
    color: '#8888a0',
    textAlign: 'center',
    padding: '60px 20px',
    fontSize: 14,
    lineHeight: 1.6,
  },
  disclaimer: {
    color: '#8888a0',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 24,
    padding: '12px 0',
    borderTop: '1px solid #2a2a3a',
  },
  timestamp: {
    color: '#8888a0',
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
  if (!confidence) return { backgroundColor: '#2a2a3a', color: '#8888a0' }
  const c = confidence.toLowerCase()
  if (c === 'high') return { backgroundColor: '#4ade8020', color: '#4ade80' }
  if (c === 'medium') return { backgroundColor: '#fbbf2420', color: '#fbbf24' }
  return { backgroundColor: '#f8717120', color: '#f87171' }
}

function getProgressColor(pct) {
  if (pct > 100) return '#f87171'
  if (pct >= 80) return '#fbbf24'
  return '#4ade80'
}

function getDayName(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}

const TOOLTIP_STYLE = {
  backgroundColor: '#16161f',
  border: '1px solid #2a2a3a',
  borderRadius: 8,
  color: '#e8e8ed',
  fontSize: 12,
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
              <label style={{ color: '#8888a0', fontSize: 12, display: 'block', marginBottom: 4 }}>Calories</label>
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
            <div style={{ color: '#fbbf24', fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
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
              <div style={{ color: '#8888a0', fontSize: 13 }}>
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
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1e1e2e')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#16161f')}
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
              tick={{ fill: '#8888a0', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#8888a0', fontSize: 11 }}
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
            <Bar dataKey="calories" fill="#fbbf24" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={styles.disclaimer}>
        Calorie counts are estimates.
      </div>
    </div>
  )
}
