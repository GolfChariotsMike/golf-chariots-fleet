import { useState, useCallback, useRef } from 'react'
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Polygon,
  Polyline,
  InfoWindow,
} from '@react-google-maps/api'
import { supabase } from '../lib/supabase'
import type { Device, Location, Geofence } from '../lib/supabase'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string

const DEFAULT_CENTER = { lat: -32.3686, lng: 115.7556 }

const MAP_OPTIONS: google.maps.MapOptions = {
  mapTypeId: 'satellite',
  tilt: 0,
  mapTypeControl: true,
  mapTypeControlOptions: { style: 2, position: 3 },
  streetViewControl: false,
  fullscreenControl: true,
  zoomControl: true,
  clickableIcons: false,
}

interface DeviceWithLocation extends Device {
  latestLocation?: Location
  hasAlert?: boolean
}

interface Props {
  devices: DeviceWithLocation[]
  geofences: Geofence[]
  selectedDeviceId: string | null
  onGeofenceCreated: () => void
}

function pixelToLatLng(map: google.maps.Map, x: number, y: number): google.maps.LatLngLiteral {
  const bounds = map.getBounds()!
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  const div = map.getDiv()
  const lng = sw.lng() + (x / div.offsetWidth) * (ne.lng() - sw.lng())
  const lat = ne.lat() - (y / div.offsetHeight) * (ne.lat() - sw.lat())
  return { lat, lng }
}

export default function FleetMap({ devices, geofences, onGeofenceCreated }: Props) {
  const { isLoaded, loadError } = useJsApiLoader({ googleMapsApiKey: GOOGLE_MAPS_API_KEY })

  const [drawing, setDrawing] = useState(false)
  const [drawPoints, setDrawPoints] = useState<google.maps.LatLngLiteral[]>([])
  const [mouseLatLng, setMouseLatLng] = useState<google.maps.LatLngLiteral | null>(null)
  const [pendingCoords, setPendingCoords] = useState<google.maps.LatLngLiteral[] | null>(null)
  const [geofenceName, setGeofenceName] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedDevice, setSelectedDevice] = useState<DeviceWithLocation | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)

  const deviceWithLoc = devices.find(d => d.latestLocation)
  const center = deviceWithLoc?.latestLocation
    ? { lat: deviceWithLoc.latestLocation.lat, lng: deviceWithLoc.latestLocation.lng }
    : DEFAULT_CENTER

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map
  }, [])

  // Overlay handles all drawing input — sits on top of the map div
  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const map = mapRef.current
    if (!map) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const latLng = pixelToLatLng(map, x, y)

    setDrawPoints(prev => {
      // Close if clicking near first point (within 20px)
      if (prev.length >= 3) {
        const firstPx = latLngToPixel(map, prev[0])
        const dist = Math.sqrt(Math.pow(x - firstPx.x, 2) + Math.pow(y - firstPx.y, 2))
        if (dist < 20) {
          setPendingCoords(prev)
          setDrawing(false)
          setMouseLatLng(null)
          return []
        }
      }
      return [...prev, latLng]
    })
  }, [])

  const handleOverlayMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const map = mapRef.current
    if (!map) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setMouseLatLng(pixelToLatLng(map, x, y))
  }, [])

  async function saveGeofence() {
    if (!pendingCoords || !geofenceName.trim()) return
    setSaving(true)
    await supabase.from('geofences').insert({
      name: geofenceName.trim(),
      coordinates: pendingCoords.map(p => [p.lat, p.lng]),
      active: true,
    })
    setSaving(false)
    setPendingCoords(null)
    setGeofenceName('')
    onGeofenceCreated()
  }

  function startDrawing() {
    setDrawing(true)
    setDrawPoints([])
    setMouseLatLng(null)
  }

  function cancelDrawing() {
    setDrawing(false)
    setDrawPoints([])
    setMouseLatLng(null)
  }

  if (loadError) return (
    <div className="map-error">
      <p>⚠️ Google Maps failed to load.</p>
      <a href="https://console.cloud.google.com/apis/library/maps-backend.googleapis.com" target="_blank" rel="noreferrer">Enable Maps JS API →</a>
    </div>
  )

  if (!isLoaded) return <div className="map-loading">Loading map…</div>

  // Live preview path
  const previewPath = mouseLatLng && drawPoints.length > 0
    ? [...drawPoints, mouseLatLng]
    : drawPoints

  // Check if mouse is near start point
  const nearStart = (() => {
    if (!mouseLatLng || drawPoints.length < 3 || !mapRef.current) return false
    const map = mapRef.current
    const firstPx = latLngToPixel(map, drawPoints[0])
    const mousePx = latLngToPixel(map, mouseLatLng)
    return Math.sqrt(Math.pow(mousePx.x - firstPx.x, 2) + Math.pow(mousePx.y - firstPx.y, 2)) < 20
  })()

  return (
    <div className="map-container">
      <div className="map-toolbar">
        {!drawing ? (
          <button className="btn-draw" onClick={startDrawing}>✏️ Draw Geofence</button>
        ) : (
          <div className="draw-instructions">
            {drawPoints.length === 0 ? 'Click to start' : nearStart ? '🟢 Click to close' : `${drawPoints.length} points — click near start to close`}
            <button className="btn-cancel" onClick={cancelDrawing}>Cancel</button>
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
              placeholder="e.g. Holes 1–9 Boundary"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && saveGeofence()}
            />
            <div className="modal-actions">
              <button onClick={saveGeofence} disabled={saving || !geofenceName.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setPendingCoords(null); setGeofenceName('') }}>Discard</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ position: 'relative', height: '100%', width: '100%' }}>
        <GoogleMap
          mapContainerStyle={{ height: '100%', width: '100%' }}
          center={center}
          zoom={deviceWithLoc ? 17 : 16}
          options={MAP_OPTIONS}
          onLoad={onMapLoad}
        >
          {/* Saved geofences */}
          {geofences.map(gf => (
            <Polygon
              key={gf.id}
              paths={(gf.coordinates as [number, number][]).map(([lat, lng]) => ({ lat, lng }))}
              options={{ strokeColor: '#3b82f6', strokeOpacity: 0.9, strokeWeight: 2, fillColor: '#3b82f6', fillOpacity: 0.15 }}
            />
          ))}

          {/* Pending saved geofence */}
          {pendingCoords && (
            <Polygon
              paths={pendingCoords}
              options={{ strokeColor: '#10b981', strokeOpacity: 0.9, strokeWeight: 2, fillColor: '#10b981', fillOpacity: 0.2 }}
            />
          )}

          {/* Live drawing preview */}
          {drawing && previewPath.length > 1 && (
            <Polyline
              path={previewPath}
              options={{ strokeColor: nearStart ? '#10b981' : '#f59e0b', strokeOpacity: 1, strokeWeight: 2.5 }}
            />
          )}

          {/* First point dot */}
          {drawing && drawPoints.length > 0 && (
            <Marker
              position={drawPoints[0]}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: nearStart ? 10 : 6,
                fillColor: nearStart ? '#10b981' : '#f59e0b',
                fillOpacity: 1,
                strokeColor: '#fff',
                strokeWeight: 2,
              }}
            />
          )}

          {/* Device markers */}
          {devices.map(device => {
            if (!device.latestLocation) return null
            const loc = device.latestLocation
            return (
              <Marker
                key={device.id}
                position={{ lat: loc.lat, lng: loc.lng }}
                icon={device.hasAlert ? {
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 10, fillColor: '#ef4444', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2,
                } : {
                  path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                  scale: 6, rotation: loc.heading ?? 0, fillColor: '#22c55e', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2,
                }}
                onClick={() => setSelectedDevice(device)}
              />
            )
          })}

          {selectedDevice?.latestLocation && (
            <InfoWindow
              position={{ lat: selectedDevice.latestLocation.lat, lng: selectedDevice.latestLocation.lng }}
              onCloseClick={() => setSelectedDevice(null)}
            >
              <div style={{ color: '#000', minWidth: 160 }}>
                <strong>{selectedDevice.name || selectedDevice.imei}</strong><br />
                Speed: {selectedDevice.latestLocation.speed ?? '—'} km/h<br />
                Heading: {selectedDevice.latestLocation.heading ?? '—'}°<br />
                Battery: {selectedDevice.latestLocation.battery ?? '—'}%<br />
                Ignition: {selectedDevice.latestLocation.ignition ? 'ON' : 'OFF'}<br />
                <small>{new Date(selectedDevice.latestLocation.recorded_at).toLocaleString()}</small>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>

        {/* Transparent overlay captures clicks during drawing */}
        {drawing && (
          <div
            ref={overlayRef}
            onClick={handleOverlayClick}
            onMouseMove={handleOverlayMouseMove}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 10,
              cursor: 'crosshair',
            }}
          />
        )}
      </div>
    </div>
  )
}

function latLngToPixel(map: google.maps.Map, latLng: google.maps.LatLngLiteral): { x: number; y: number } {
  const bounds = map.getBounds()!
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  const div = map.getDiv()
  const x = (latLng.lng - sw.lng()) / (ne.lng() - sw.lng()) * div.offsetWidth
  const y = (ne.lat() - latLng.lat) / (ne.lat() - sw.lat()) * div.offsetHeight
  return { x, y }
}
