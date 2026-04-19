import { useState, useEffect, useCallback } from 'react'
import { getDailyMetrics, getLast7DaysMetrics } from '../../lib/storage'
import { useSession } from '../../lib/session'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const COLORS = {
  OUTSIDE: '#55624d',
  INSIDE: '#3b82f6',
  SCREEN: '#f59e0b',
  UNCERTAIN: '#9ca3af',
}

const LABELS = {
  OUTSIDE: 'Outside',
  INSIDE: 'Inside',
  SCREEN: 'Screen',
}

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
  barContainer: {
    display: 'flex',
    borderRadius: 9999,
    overflow: 'hidden',
    height: 28,
    backgroundColor: '#ecefe8',
    marginBottom: 10,
  },
  barSegment: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    fontWeight: 600,
    color: '#ffffff',
    transition: 'width 400ms ease-in-out',
    minWidth: 0,
  },
  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
  },
  labelItem: {
    flex: 1,
    textAlign: 'center',
    fontSize: '0.625rem',
    color: '#8888a0',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  labelDot: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginRight: 4,
    verticalAlign: 'middle',
  },
  sceneBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    borderRadius: 9999,
    fontSize: 13,
    fontWeight: 600,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: '#f87171',
    animation: 'pulse 1.5s infinite',
  },
  targetRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  targetLabel: {
    color: '#191c18',
    fontSize: 13,
  },
  targetValue: {
    color: '#444841',
    fontSize: 12,
  },
  progressBarOuter: {
    height: 8,
    backgroundColor: '#ecefe8',
    borderRadius: 9999,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressBarInner: {
    height: '100%',
    borderRadius: 9999,
    transition: 'width 400ms ease-in-out',
  },
  targetInput: {
    width: 56,
    padding: '3px 6px',
    borderRadius: 6,
    border: '1px solid rgba(197,200,190,0.5)',
    backgroundColor: '#f2f4ed',
    color: '#191c18',
    fontSize: 12,
    textAlign: 'right',
    outline: 'none',
  },
  coverageWarning: {
    backgroundColor: 'rgba(245,158,11,0.10)',
    color: '#92400e',
    fontSize: 12,
    padding: '8px 12px',
    borderRadius: 8,
    marginBottom: 12,
  },
  emptyState: {
    color: '#444841',
    textAlign: 'center',
    padding: '60px 20px',
    fontSize: 14,
    lineHeight: 1.6,
  },
  chartContainer: {
    height: 220,
    marginTop: 8,
  },
}

function formatMinutes(min) {
  if (!min || min <= 0) return '0m'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
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

export default function MetricsTab() {
  const { currentScene, lastSavedAt } = useSession()
  const [todayMetrics, setTodayMetrics] = useState({ OUTSIDE: 0, INSIDE: 0, SCREEN: 0 })
  const [weekMetrics, setWeekMetrics] = useState([])
  const [outsideTarget, setOutsideTarget] = useState(() => {
    const stored = localStorage.getItem('persona_outsideTarget')
    return stored ? Number(stored) : 120
  })
  const [screenLimit, setScreenLimit] = useState(() => {
    const stored = localStorage.getItem('persona_screenLimit')
    return stored ? Number(stored) : 360
  })

  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()

  const loadData = useCallback(async () => {
    const [daily, weekly] = await Promise.all([
      getDailyMetrics(todayStr),
      getLast7DaysMetrics(),
    ])
    setTodayMetrics(daily)
    setWeekMetrics(weekly)
  }, [todayStr])

  useEffect(() => {
    loadData()
  }, [loadData, lastSavedAt])

  // Persist targets
  useEffect(() => {
    localStorage.setItem('persona_outsideTarget', String(outsideTarget))
  }, [outsideTarget])

  useEffect(() => {
    localStorage.setItem('persona_screenLimit', String(screenLimit))
  }, [screenLimit])

  const totalMinutes = todayMetrics.OUTSIDE + todayMetrics.INSIDE + todayMetrics.SCREEN
  const isEmpty = totalMinutes === 0 && weekMetrics.every((d) => d.OUTSIDE + d.INSIDE + d.SCREEN === 0)

  if (isEmpty) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          No metrics yet. Start a session to track your environment.
        </div>
      </div>
    )
  }

  const getBarWidth = (val) => (totalMinutes > 0 ? (val / totalMinutes) * 100 : 0)

  const sceneBadgeColor = COLORS[currentScene] || COLORS.UNCERTAIN
  const sceneBadgeLabel = LABELS[currentScene] || currentScene || 'Idle'

  // Coverage check: rough estimate based on expected polls
  const expectedPolls = totalMinutes // each minute ≈ one poll if interval is 60s
  const classifiedPolls = todayMetrics.OUTSIDE + todayMetrics.INSIDE + todayMetrics.SCREEN
  const coverageRatio = expectedPolls > 0 ? classifiedPolls / expectedPolls : 1
  const lowCoverage = expectedPolls > 10 && coverageRatio < 0.7

  const outsideProgress = outsideTarget > 0 ? Math.min((todayMetrics.OUTSIDE / outsideTarget) * 100, 100) : 0
  const screenProgress = screenLimit > 0 ? Math.min((todayMetrics.SCREEN / screenLimit) * 100, 100) : 0
  const screenOver = screenLimit > 0 && todayMetrics.SCREEN > screenLimit

  return (
    <div style={styles.container}>
      {/* Current scene badge */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            ...styles.sceneBadge,
            backgroundColor: sceneBadgeColor + '20',
            color: sceneBadgeColor,
          }}
        >
          <div style={styles.liveDot} />
          {sceneBadgeLabel}
        </div>
      </div>

      {/* Today bar */}
      <div style={styles.sectionTitle}>Today</div>
      <div style={styles.card}>
        <div style={styles.barContainer}>
          {totalMinutes > 0 ? (
            <>
              {todayMetrics.OUTSIDE > 0 && (
                <div
                  style={{
                    ...styles.barSegment,
                    width: `${getBarWidth(todayMetrics.OUTSIDE)}%`,
                    backgroundColor: COLORS.OUTSIDE,
                  }}
                >
                  {getBarWidth(todayMetrics.OUTSIDE) > 12 ? formatMinutes(todayMetrics.OUTSIDE) : ''}
                </div>
              )}
              {todayMetrics.INSIDE > 0 && (
                <div
                  style={{
                    ...styles.barSegment,
                    width: `${getBarWidth(todayMetrics.INSIDE)}%`,
                    backgroundColor: COLORS.INSIDE,
                  }}
                >
                  {getBarWidth(todayMetrics.INSIDE) > 12 ? formatMinutes(todayMetrics.INSIDE) : ''}
                </div>
              )}
              {todayMetrics.SCREEN > 0 && (
                <div
                  style={{
                    ...styles.barSegment,
                    width: `${getBarWidth(todayMetrics.SCREEN)}%`,
                    backgroundColor: COLORS.SCREEN,
                  }}
                >
                  {getBarWidth(todayMetrics.SCREEN) > 12 ? formatMinutes(todayMetrics.SCREEN) : ''}
                </div>
              )}
            </>
          ) : null}
        </div>

        <div style={styles.labelRow}>
          <div style={styles.labelItem}>
            <span style={{ ...styles.labelDot, backgroundColor: COLORS.OUTSIDE }} />
            {formatMinutes(todayMetrics.OUTSIDE)} Outside
          </div>
          <div style={styles.labelItem}>
            <span style={{ ...styles.labelDot, backgroundColor: COLORS.INSIDE }} />
            {formatMinutes(todayMetrics.INSIDE)} Inside
          </div>
          <div style={styles.labelItem}>
            <span style={{ ...styles.labelDot, backgroundColor: COLORS.SCREEN }} />
            {formatMinutes(todayMetrics.SCREEN)} Screen
          </div>
        </div>
      </div>

      {/* Low coverage warning */}
      {lowCoverage && (
        <div style={styles.coverageWarning}>
          Low coverage — {Math.round(coverageRatio * 100)}% classified
        </div>
      )}

      {/* User targets */}
      <div style={styles.sectionTitle}>Daily Targets</div>
      <div style={styles.card}>
        <div style={styles.targetRow}>
          <span style={styles.targetLabel}>
            Outside goal: {formatMinutes(todayMetrics.OUTSIDE)} / {formatMinutes(outsideTarget)}
          </span>
          <input
            style={styles.targetInput}
            type="number"
            min={0}
            value={outsideTarget}
            onChange={(e) => setOutsideTarget(Math.max(0, Number(e.target.value)))}
            title="Target minutes"
          />
        </div>
        <div style={styles.progressBarOuter}>
          <div
            style={{
              ...styles.progressBarInner,
              width: `${outsideProgress}%`,
              backgroundColor: COLORS.OUTSIDE,
            }}
          />
        </div>

        <div style={styles.targetRow}>
          <span style={styles.targetLabel}>
            Screen limit: {formatMinutes(todayMetrics.SCREEN)} / {formatMinutes(screenLimit)}
          </span>
          <input
            style={styles.targetInput}
            type="number"
            min={0}
            value={screenLimit}
            onChange={(e) => setScreenLimit(Math.max(0, Number(e.target.value)))}
            title="Limit minutes"
          />
        </div>
        <div style={styles.progressBarOuter}>
          <div
            style={{
              ...styles.progressBarInner,
              width: `${screenProgress}%`,
              backgroundColor: screenOver ? '#dc2626' : COLORS.SCREEN,
            }}
          />
        </div>
      </div>

      {/* 7-day chart */}
      <div style={styles.sectionTitle}>Last 7 Days</div>
      <div style={{ ...styles.card, ...styles.chartContainer }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={weekMetrics.map((d) => ({ ...d, day: getDayName(d.date) }))}>
            <XAxis dataKey="day" tick={{ fill: '#444841', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fill: '#444841', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatMinutes(v)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(val, name) => [formatMinutes(val), LABELS[name] || name]}
            />
            <Bar dataKey="OUTSIDE" stackId="a" fill={COLORS.OUTSIDE} radius={[0, 0, 0, 0]} />
            <Bar dataKey="INSIDE" stackId="a" fill={COLORS.INSIDE} radius={[0, 0, 0, 0]} />
            <Bar dataKey="SCREEN" stackId="a" fill={COLORS.SCREEN} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
