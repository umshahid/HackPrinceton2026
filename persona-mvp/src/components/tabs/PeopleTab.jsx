import { useState, useEffect, useCallback } from 'react'
import { getPersons, getAllInteractions, updatePerson, deletePerson } from '../../lib/storage'
import { useSession } from '../../lib/session'

const styles = {
  container: {
    padding: 16,
    minHeight: '100%',
  },
  searchBar: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #2a2a3a',
    backgroundColor: '#16161f',
    color: '#e8e8ed',
    fontSize: 14,
    marginBottom: 16,
    outline: 'none',
    boxSizing: 'border-box',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: 12,
  },
  personCard: {
    backgroundColor: '#16161f',
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
    border: '1px solid #2a2a3a',
  },
  thumbnail: {
    width: 96,
    height: 96,
    borderRadius: '50%',
    objectFit: 'cover',
    backgroundColor: '#2a2a3a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 36,
    color: '#8888a0',
    marginBottom: 10,
    overflow: 'hidden',
  },
  personName: {
    color: '#e8e8ed',
    fontSize: 14,
    fontWeight: 600,
    textAlign: 'center',
    marginBottom: 4,
  },
  interactionCount: {
    color: '#8888a0',
    fontSize: 12,
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
  detailName: {
    color: '#e8e8ed',
    fontSize: 20,
    fontWeight: 700,
    flex: 1,
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
  renameInput: {
    backgroundColor: '#16161f',
    border: '1px solid #60a5fa',
    color: '#e8e8ed',
    fontSize: 18,
    fontWeight: 700,
    padding: '4px 8px',
    borderRadius: 6,
    outline: 'none',
    flex: 1,
  },
  interactionCard: {
    backgroundColor: '#16161f',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    border: '1px solid #2a2a3a',
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
    backgroundColor: '#2a2a3a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    color: '#8888a0',
    overflow: 'hidden',
    flexShrink: 0,
  },
  interactionMeta: {
    flex: 1,
  },
  dateText: {
    color: '#e8e8ed',
    fontSize: 13,
    fontWeight: 500,
  },
  durationText: {
    color: '#8888a0',
    fontSize: 12,
  },
  overviewText: {
    color: '#e8e8ed',
    fontSize: 13,
    lineHeight: 1.5,
    marginBottom: 8,
  },
  pillContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  pill: {
    backgroundColor: '#2a2a3a',
    color: '#60a5fa',
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 12,
  },
  actionItem: {
    color: '#e8e8ed',
    fontSize: 12,
    lineHeight: 1.6,
    paddingLeft: 12,
  },
  expandBtn: {
    background: 'none',
    border: 'none',
    color: '#60a5fa',
    fontSize: 12,
    cursor: 'pointer',
    padding: '6px 0',
    marginTop: 4,
  },
  transcript: {
    backgroundColor: '#0a0a0f',
    borderRadius: 8,
    padding: 12,
    color: '#8888a0',
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
    color: '#f87171',
    fontSize: 12,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
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
          {person?.faceThumbnail ? (
            <img src={person.faceThumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            '\u{1F464}'
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

  const { state } = useSession()

  const loadData = useCallback(async () => {
    const [p, i] = await Promise.all([getPersons(), getAllInteractions()])
    setPersons(p)
    setInteractions(i)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData, state])

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
              onClick={() => setSelectedPerson(person)}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1e1e2e')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#16161f')}
            >
              <div style={styles.thumbnail}>
                {person.faceThumbnail ? (
                  <img
                    src={person.faceThumbnail}
                    alt={person.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  '\u{1F464}'
                )}
              </div>
              <div style={styles.personName}>{person.name || 'Unknown'}</div>
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
