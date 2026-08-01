import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Geofence } from '../lib/supabase'

interface Props {
  geofences: Geofence[]
  selectedGeofenceId: string | null
  onSelect: (id: string | null) => void
  onChanged: () => void
}

export default function GeofencePanel({ geofences, selectedGeofenceId, onSelect, onChanged }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  async function startEdit(gf: Geofence) {
    setEditingId(gf.id)
    setEditName(gf.name)
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return
    await supabase.from('geofences').update({ name: editName.trim() }).eq('id', id)
    setEditingId(null)
    onChanged()
  }

  async function toggleActive(gf: Geofence) {
    await supabase.from('geofences').update({ active: !gf.active }).eq('id', gf.id)
    onChanged()
  }

  async function deleteGeofence(id: string) {
    setDeleting(id)
    // Clear alerts referencing this geofence first (foreign key constraint)
    await supabase.from('geofence_alerts').delete().eq('geofence_id', id)
    await supabase.from('geofences').delete().eq('id', id)
    if (selectedGeofenceId === id) onSelect(null)
    setDeleting(null)
    onChanged()
  }

  if (geofences.length === 0) return null

  return (
    <div className="geofence-panel">
      <div className="section-title">GEOFENCES ({geofences.length})</div>
      <div className="geofence-list">
        {geofences.map(gf => (
          <div
            key={gf.id}
            className={`geofence-item${selectedGeofenceId === gf.id ? ' selected' : ''}${!gf.active ? ' inactive' : ''}`}
            onClick={() => onSelect(selectedGeofenceId === gf.id ? null : gf.id)}
          >
            {editingId === gf.id ? (
              <div className="geofence-edit-row" onClick={e => e.stopPropagation()}>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(gf.id); if (e.key === 'Escape') setEditingId(null) }}
                  autoFocus
                />
                <button onClick={() => saveEdit(gf.id)}>✓</button>
                <button onClick={() => setEditingId(null)}>✕</button>
              </div>
            ) : (
              <div className="geofence-row">
                <span className={`geofence-dot${gf.active ? ' active' : ''}`} />
                <span className="geofence-name">{gf.name}</span>
                <div className="geofence-actions" onClick={e => e.stopPropagation()}>
                  <button title={gf.active ? 'Disable' : 'Enable'} onClick={() => toggleActive(gf)}>
                    {gf.active ? '⏸' : '▶'}
                  </button>
                  <button title="Rename" onClick={() => startEdit(gf)}>✏️</button>
                  <button
                    title="Delete"
                    className="btn-delete"
                    disabled={deleting === gf.id}
                    onClick={() => { if (confirm(`Delete "${gf.name}"?`)) deleteGeofence(gf.id) }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
