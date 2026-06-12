import { useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polygon, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import type { Device, Location, Geofence } from '../lib/supabase'

// Fix leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

const alertIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
})

interface DeviceWithLocation extends Device {
  latestLocation?: Location
  hasAlert?: boolean
}

interface Props {
  devices: DeviceWithLocation[]
  geofences: Geofence[]
  selectedDeviceId: string | null  // eslint-disable-line @typescript-eslint/no-unused-vars
  onGeofenceCreated: () => void
}

function DrawingLayer({ onComplete }: { onComplete: (coords: [number, number][]) => void }) {
  const [points, setPoints] = useState<[number, number][]>([])

  useMapEvents({
    click(e) {
      setPoints(prev => [...prev, [e.latlng.lat, e.latlng.lng]])
    },
    dblclick(e) {
      const newPoints = [...points, [e.latlng.lat, e.latlng.lng]] as [number, number][]
      if (newPoints.length >= 3) {
        onComplete(newPoints)
      }
      setPoints([])
    }
  })

  return points.length > 0 ? <Polygon positions={points} color="#f59e0b" fillOpacity={0.2} /> : null
}

export default function FleetMap({ devices, geofences, onGeofenceCreated }: Props) {
  const [drawing, setDrawing] = useState(false)
  const [pendingCoords, setPendingCoords] = useState<[number, number][] | null>(null)
  const [geofenceName, setGeofenceName] = useState('')
  const [saving, setSaving] = useState(false)

  // Default center: Australia
  const center: [number, number] = [devices.find(d => d.latestLocation)?.latestLocation
    ? [devices.find(d => d.latestLocation)!.latestLocation!.lat, devices.find(d => d.latestLocation)!.latestLocation!.lng] as [number, number]
    : [-25.2744, 133.7751] as [number, number]
  ][0]

  async function saveGeofence() {
    if (!pendingCoords || !geofenceName.trim()) return
    setSaving(true)
    await supabase.from('geofences').insert({
      name: geofenceName.trim(),
      coordinates: pendingCoords,
      active: true
    })
    setSaving(false)
    setPendingCoords(null)
    setGeofenceName('')
    setDrawing(false)
    onGeofenceCreated()
  }

  return (
    <div className="map-container">
      <div className="map-toolbar">
        {!drawing ? (
          <button className="btn-draw" onClick={() => setDrawing(true)}>✏️ Draw Geofence</button>
        ) : (
          <div className="draw-instructions">
            Click to add points • Double-click to finish
            <button className="btn-cancel" onClick={() => { setDrawing(false); setPendingCoords(null) }}>Cancel</button>
          </div>
        )}
      </div>

      {pendingCoords && (
        <div className="geofence-modal">
          <div className="geofence-modal-inner">
            <h3>Name this geofence</h3>
            <input
              value={geofenceName}
              onChange={e => setGeofenceName(e.target.value)}
              placeholder="e.g. Golf Course Boundary"
              autoFocus
            />
            <div className="modal-actions">
              <button onClick={saveGeofence} disabled={saving || !geofenceName.trim()}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setPendingCoords(null); setGeofenceName('') }}>Discard</button>
            </div>
          </div>
        </div>
      )}

      <MapContainer
        center={center}
        zoom={5}
        style={{ height: '100%', width: '100%' }}
        doubleClickZoom={!drawing}
      >
        <TileLayer
          attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {geofences.map(gf => (
          <Polygon
            key={gf.id}
            positions={gf.coordinates}
            color="#3b82f6"
            fillOpacity={0.15}
          >
            <Popup>{gf.name}</Popup>
          </Polygon>
        ))}

        {devices.map(device => {
          if (!device.latestLocation) return null
          const loc = device.latestLocation
          return (
            <Marker
              key={device.id}
              position={[loc.lat, loc.lng]}
              icon={device.hasAlert ? alertIcon : undefined}
            >
              <Popup>
                <strong>{device.name || device.imei}</strong><br />
                Speed: {loc.speed ?? '—'} km/h<br />
                Heading: {loc.heading ?? '—'}°<br />
                Battery: {loc.battery ?? '—'}%<br />
                Satellites: {loc.satellites ?? '—'}<br />
                Ignition: {loc.ignition ? 'ON' : 'OFF'}<br />
                <small>{new Date(loc.recorded_at).toLocaleString()}</small>
              </Popup>
            </Marker>
          )
        })}

        {drawing && !pendingCoords && (
          <DrawingLayer onComplete={setPendingCoords} />
        )}
      </MapContainer>
    </div>
  )
}
