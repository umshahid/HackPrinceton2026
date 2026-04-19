import { useState, useEffect, useCallback } from 'react'
import { getPersons, getAllInteractions, updatePerson, deletePerson } from '../../lib/storage'
import { useSession } from '../../lib/session'

const styles = {
  container: {
    padding: 16,
    minHeight: '100%',
    background: 'var(--surface)',
  },
  searchBar: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: '9999px',
    border: '1px solid rgba(197,200,190,0.5)',
    backgroundColor: '#ffffff',
    color: '#191c18',
    fontSize: 14,
    marginBottom: 16,
    outline: 'none',
    boxSizing: 'border-box',
    boxShadow: '0 2px 12px rgba(85,98,77,0.05)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: 12,
  },
  personCard: {
    backgroundColor: '#ffffff',
    borderRadius: '1.5rem',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    cursor: 'pointer',
    transition: 'background-color 400ms ease-in-out, box-shadow 400ms ease-in-out',
    boxShadow: '0 4px 40px rgba(85,98,77,0.06)',
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    objectFit: 'cover',
    backgroundColor: '#d9e7cd',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    color: '#55624d',
    marginBottom: 10,
    overflow: 'hidden',
  },
  personName: {
    color: '#191c18',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: 'Manrope, sans-serif',
    textAlign: 'center',
    marginBottom: 4,
  },
  interactionCount: {
    color: '#444841',
    fontSize: '0.625rem',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  detailHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
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
  detailName: {
    color: '#191c18',
    fontSize: 20,
    fontWeight: 700,
    fontFamily: 'Manrope, sans-serif',
    flex: 1,
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
  renameInput: {
    backgroundColor: '#f2f4ed',
    border: '1px solid #55624d',
    color: '#191c18',
    fontSize: 18,
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: '0.75rem',
    outline: 'none',
    flex: 1,
  },
  interactionCard: {
    backgroundColor: '#ffffff',
    borderRadius: '1.5rem',
    padding: 16,
    marginBottom: 10,
    boxShadow: '0 4px 40px rgba(85,98,77,0.06)',
  },
  interactionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  smallThumb: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    backgroundColor: '#d9e7cd',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    color: '#55624d',
    overflow: 'hidden',
    flexShrink: 0,
  },
  interactionMeta: {
    flex: 1,
  },
  dateText: {
    color: '#191c18',
    fontSize: 13,
    fontWeight: 500,
  },
  durationText: {
    color: '#444841',
    fontSize: '0.625rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  overviewText: {
    color: '#191c18',
    fontSize: 13,
    lineHeight: 1.6,
    marginBottom: 8,
  },
  pillContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  pill: {
    backgroundColor: '#d9e7cd',
    color: '#55624d',
    fontSize: 11,
    padding: '3px 10px',
    borderRadius: 9999,
    fontWeight: 500,
  },
  actionItem: {
    color: '#444841',
    fontSize: 12,
    lineHeight: 1.6,
    paddingLeft: 12,
  },
  expandBtn: {
    background: 'none',
    border: 'none',
    color: '#55624d',
    fontSize: 12,
    cursor: 'pointer',
    padding: '6px 0',
    marginTop: 4,
    fontWeight: 600,
  },
  transcript: {
    backgroundColor: '#f2f4ed',
    borderRadius: '0.75rem',
    padding: 12,
    color: '#444841',
    fontSize: 12,
    lineHeight: 1.6,
    marginTop: 8,
    whiteSpace: 'pre-wrap',
    maxHeight: 300,
    overflowY: 'auto',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#dc2626',
    fontSize: 12,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
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
    borderTop: '1px solid #2a2a3a',
  },
}

const AVATAR_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777']

function avatarColor(id) {
  return AVATAR_COLORS[(id || 0) % AVATAR_COLORS.length]
}

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function InitialsAvatar({ name, id, size = 96, fontSize = 34 }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      backgroundColor: avatarColor(id),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize,
      fontWeight: 700,
      color: '#fff',
      flexShrink: 0,
      userSelect: 'none',
    }}>
      {getInitials(name)}
    </div>
  )
}

function formatDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDuration(startStr, endStr) {
  if (!startStr || !endStr) return ''
  const ms = new Date(endStr) - new Date(startStr)
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function InteractionEntry({ interaction, person, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const summary = interaction.summary || {}

  return (
    <div style={styles.interactionCard}>
      <div style={styles.interactionHeader}>
        <div style={styles.smallThumb}>
          {person?.thumbnail ? (
            <img src={person.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
          ) : (
            <InitialsAvatar name={person?.name} id={person?.id} size={40} fontSize={15} />
          )}
        </div>
        <div style={styles.interactionMeta}>
          <div style={styles.dateText}>{formatDate(interaction.startTime)}</div>
          <div style={styles.durationText}>
            {formatDuration(interaction.startTime, interaction.endTime)}
          </div>
        </div>
        <button style={styles.deleteBtn} onClick={() => onDelete(interaction.id)}>
          Delete
        </button>
      </div>

      {summary.overview && (
        <div style={styles.overviewText}>{summary.overview}</div>
      )}

      {summary.key_topics && summary.key_topics.length > 0 && (
        <div style={styles.pillContainer}>
          {summary.key_topics.map((topic, i) => (
            <span key={i} style={styles.pill}>{topic}</span>
          ))}
        </div>
      )}

      {summary.action_items && summary.action_items.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          {summary.action_items.map((item, i) => (
            <div key={i} style={styles.actionItem}>{'\u2022'} {item}</div>
          ))}
        </div>
      )}

      {interaction.transcript && (
        <>
          <button style={styles.expandBtn} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide transcript' : 'Show transcript'}
          </button>
          {expanded && (
            <div style={styles.transcript}>{interaction.transcript}</div>
          )}
        </>
      )}
    </div>
  )
}

export default function PeopleTab() {
  const [persons, setPersons] = useState([])
  const [interactions, setInteractions] = useState([])
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  const { lastSavedAt } = useSession()

  const loadData = useCallback(async () => {
    const [p, i] = await Promise.all([getPersons(), getAllInteractions()])
    setPersons(p)
    setInteractions(i)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData, lastSavedAt])

  const interactionCountByPerson = interactions.reduce((acc, i) => {
    if (i.personId) acc[i.personId] = (acc[i.personId] || 0) + 1
    return acc
  }, {})

  const filteredPersons = persons.filter((p) => {
    if (!search) return true
    const q = search.toLowerCase()
    if (p.name?.toLowerCase().includes(q)) return true
    // Check interactions for this person
    return interactions.some(
      (i) =>
        i.personId === p.id &&
        ((i.summary?.overview || '').toLowerCase().includes(q) ||
          (i.transcript || '').toLowerCase().includes(q))
    )
  })

  const personInteractions = selectedPerson
    ? interactions.filter((i) => i.personId === selectedPerson.id)
    : []

  const handleDeleteInteraction = async (interactionId) => {
    const { default: localforage } = await import('localforage')
    await localforage.removeItem(`interaction:${interactionId}`)
    await loadData()
  }

  const handleRename = async (personId) => {
    if (editName.trim()) {
      await updatePerson(personId, { name: editName.trim() })
      setEditingId(null)
      await loadData()
      if (selectedPerson?.id === personId) {
        setSelectedPerson((prev) => ({ ...prev, name: editName.trim() }))
      }
    }
  }

  // Detail view
  if (selectedPerson) {
    return (
      <div style={styles.container}>
        <div style={styles.detailHeader}>
          <button style={styles.backBtn} onClick={() => setSelectedPerson(null)}>
            &#8592; Back
          </button>
          {editingId === selectedPerson.id ? (
            <>
              <input
                style={styles.renameInput}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(selectedPerson.id)
                  if (e.key === 'Escape') setEditingId(null)
                }}
                autoFocus
              />
              <button style={styles.editBtn} onClick={() => handleRename(selectedPerson.id)}>
                Save
              </button>
            </>
          ) : (
            <>
              <span style={styles.detailName}>{selectedPerson.name || 'Unknown'}</span>
              <button
                style={styles.editBtn}
                onClick={() => {
                  setEditingId(selectedPerson.id)
                  setEditName(selectedPerson.name || '')
                }}
              >
                Edit
              </button>
            </>
          )}
        </div>

        {personInteractions.length === 0 ? (
          <div style={styles.emptyState}>No interactions recorded with this person yet.</div>
        ) : (
          personInteractions.map((interaction) => (
            <InteractionEntry
              key={interaction.id}
              interaction={interaction}
              person={selectedPerson}
              onDelete={handleDeleteInteraction}
            />
          ))
        )}

        <div style={styles.disclaimer}>
          Other party's speech may be lower quality.
        </div>
      </div>
    )
  }

  // Grid view
  return (
    <div style={styles.container}>
      <input
        style={styles.searchBar}
        placeholder="Search people, summaries, transcripts..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {filteredPersons.length === 0 && !search ? (
        <div style={styles.emptyState}>
          No people detected yet. Start a session to begin.
        </div>
      ) : filteredPersons.length === 0 ? (
        <div style={styles.emptyState}>No results found.</div>
      ) : (
        <div style={styles.grid}>
          {filteredPersons.map((person) => (
            <div
              key={person.id}
              style={styles.personCard}
              onClick={() => editingId !== person.id && setSelectedPerson(person)}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1e1e2e')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#16161f')}
            >
              <div style={styles.thumbnail}>
                {person.thumbnail ? (
                  <img
                    src={person.thumbnail}
                    alt={person.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                  />
                ) : (
                  <InitialsAvatar name={person.name} id={person.id} size={96} fontSize={34} />
                )}
              </div>

              {editingId === person.id ? (
                <input
                  style={{
                    ...styles.renameInput,
                    fontSize: 13,
                    padding: '3px 6px',
                    textAlign: 'center',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(person.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onBlur={() => handleRename(person.id)}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
                  <div style={{ ...styles.personName, margin: 0 }}>{person.name || 'Unknown'}</div>
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8888a0', fontSize: 12, padding: '0 2px', lineHeight: 1 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingId(person.id)
                      setEditName(person.name || '')
                    }}
                    title="Rename"
                  >
                    ✎
                  </button>
                </div>
              )}

              <div style={styles.interactionCount}>
                {interactionCountByPerson[person.id] || 0} interactions
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={styles.disclaimer}>
        Other party's speech may be lower quality.
      </div>
    </div>
  )
}
