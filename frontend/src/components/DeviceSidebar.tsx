import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Device, Location, GeofenceAlert } from '../lib/supabase'

interface DeviceWithLocation extends Device {
  latestLocation?: Location
  hasAlert?: boolean
}

interface Props {
  devices: DeviceWithLocation[]
  alerts: GeofenceAlert[]
  selectedDeviceId: string | null
  onSelectDevice: (id: string) => void
  onDeviceAdded: () => void
}

function timeSince(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function batteryColor(pct: number | null | undefined): string {
  if (pct == null) return '#888'
  if (pct > 60) return '#22c55e'
  if (pct > 30) return '#f59e0b'
  return '#ef4444'
}

export default function DeviceSidebar({ devices, alerts, selectedDeviceId, onSelectDevice, onDeviceAdded }: Props) {
  const recentAlerts = alerts.slice(0, 5)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newImei, setNewImei] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  async function addDevice() {
    const imei = newImei.trim()
    const name = newName.trim()
    if (!imei) { setError('IMEI is required'); return }
    if (!/^\d{15}$/.test(imei)) { setError('IMEI must be 15 digits'); return }
    setAdding(true)
    setError('')
    const { error: err } = await supabase.from('devices').insert({ imei, name: name || null })
    setAdding(false)
    if (err) { setError(err.message); return }
    setNewName('')
    setNewImei('')
    setShowAdd(false)
    onDeviceAdded()
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>⛳ Fleet Tracker</h1>
        <p className="subtitle">Golf Chariots / MIROJO</p>
      </div>

      <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>DEVICES ({devices.length})</span>
        <button className="btn-add-device" onClick={() => { setShowAdd(v => !v); setError('') }}>＋</button>
      </div>

      {showAdd && (
        <div className="add-device-form">
          <input
            placeholder="Device name (e.g. Trike 1)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            autoFocus
          />
          <input
            placeholder="IMEI (15 digits)"
            value={newImei}
            onChange={e => setNewImei(e.target.value.replace(/\D/g, '').slice(0, 15))}
            onKeyDown={e => e.key === 'Enter' && addDevice()}
          />
          {error && <div className="add-device-error">{error}</div>}
          <div className="add-device-actions">
            <button onClick={addDevice} disabled={adding}>{adding ? 'Adding…' : 'Add Device'}</button>
            <button onClick={() => { setShowAdd(false); setError(''); setNewName(''); setNewImei('') }}>Cancel</button>
          </div>
        </div>
      )}
      <div className="device-list">
        {devices.length === 0 && (
          <div className="empty-state">No devices registered yet.<br />Connect a VL802 tracker to get started.</div>
        )}
        {devices.map(device => {
          const loc = device.latestLocation
          const isSelected = device.id === selectedDeviceId
          return (
            <div
              key={device.id}
              className={`device-card${isSelected ? ' selected' : ''}${device.hasAlert ? ' alert' : ''}`}
              onClick={() => onSelectDevice(device.id)}
            >
              <div className="device-row">
                <div className="device-status-dot" style={{ background: loc ? '#22c55e' : '#555' }} />
                <div className="device-name">{device.name || device.imei}</div>
                {device.hasAlert && <span className="alert-badge">⚠ ALERT</span>}
              </div>
              {loc ? (
                <div className="device-meta">
                  <span>🕐 {timeSince(loc.recorded_at)}</span>
                  <span>💨 {loc.speed != null ? `${loc.speed} km/h` : '—'}</span>
                  <span style={{ color: batteryColor(loc.battery) }}>
                    🔋 {loc.battery != null ? `${loc.battery}%` : '—'}
                  </span>
                  <span>{loc.ignition ? '🔑 ON' : '🔑 OFF'}</span>
                </div>
              ) : (
                <div className="device-meta"><span className="no-signal">No signal</span></div>
              )}
              <div className="device-imei">IMEI: {device.imei}</div>
            </div>
          )
        })}
      </div>

      {recentAlerts.length > 0 && (
        <>
          <div className="section-title">RECENT ALERTS</div>
          <div className="alert-list">
            {recentAlerts.map(alert => (
              <div key={alert.id} className="alert-item">
                <span className="alert-type">{alert.alert_type.toUpperCase()}</span>
                <span className="alert-time">{timeSince(alert.created_at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
