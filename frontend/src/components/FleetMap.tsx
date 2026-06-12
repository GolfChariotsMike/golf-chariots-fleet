import { useState, useCallback, useRef, useEffect } from 'react'
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
const CLOSE_THRESHOLD_PX = 20 // pixels from first point to auto-close

// Links Kennedy Bay Golf Course, Port Kennedy WA
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

// Pencil cursor (SVG as data URL)
const PENCIL_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath fill='%23ffffff' stroke='%23000' stroke-width='1' d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'/%3E%3C/svg%3E") 0 24, crosshair`

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

export default function FleetMap({ devices, geofences, onGeofenceCreated }: Props) {
  const { isLoaded, loadError } = useJsApiLoader({ googleMapsApiKey: GOOGLE_MAPS_API_KEY })

  const [drawing, setDrawing] = useState(false)
  const [drawPoints, setDrawPoints] = useState<google.maps.LatLngLiteral[]>([])
  const [mousePos, setMousePos] = useState<google.maps.LatLngLiteral | null>(null)
  const [nearStart, setNearStart] = useState(false)
  const [pendingCoords, setPendingCoords] = useState<google.maps.LatLngLiteral[] | null>(null)
  const [geofenceName, setGeofenceName] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedDevice, setSelectedDevice] = useState<DeviceWithLocation | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)

  const deviceWithLoc = devices.find(d => d.latestLocation)
  const center = deviceWithLoc?.latestLocation
    ? { lat: deviceWithLoc.latestLocation.lat, lng: deviceWithLoc.latestLocation.lng }
    : DEFAULT_CENTER

  // Apply pencil cursor to map container when drawing
  useEffect(() => {
    const container = mapRef.current?.getDiv()
    if (!container) return
    container.style.cursor = drawing ? PENCIL_CURSOR : ''
  }, [drawing])

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map
  }, [])

  // Convert lat/lng to pixel position on map
  const latLngToPixel = useCallback((latLng: google.maps.LatLngLiteral): { x: number; y: number } | null => {
    const map = mapRef.current
    if (!map) return null
    const projection = map.getProjection()
    const bounds = map.getBounds()
    const div = map.getDiv()
    if (!projection || !bounds) return null
    const ne = bounds.getNorthEast()
    const sw = bounds.getSouthWest()
    const nePx = projection.fromLatLngToPoint(ne)!
    const swPx = projection.fromLatLngToPoint(sw)!
    const scale = Math.pow(2, map.getZoom()!)
    const worldPt = projection.fromLatLngToPoint(new google.maps.LatLng(latLng))!
    return {
      x: (worldPt.x - swPx.x) * scale * (div.offsetWidth / ((nePx.x - swPx.x) * scale)),
      y: (worldPt.y - nePx.y) * scale * (div.offsetHeight / ((swPx.y - nePx.y) * scale)),
    }
  }, [])

  const handleMouseMove = useCallback((e: google.maps.MapMouseEvent) => {
    if (!drawing || !e.latLng) return
    const pos = { lat: e.latLng.lat(), lng: e.latLng.lng() }
    setMousePos(pos)

    // Check if near first point
    if (drawPoints.length >= 3) {
      const firstPx = latLngToPixel(drawPoints[0])
      const curPx = latLngToPixel(pos)
      if (firstPx && curPx) {
        const dist = Math.sqrt(Math.pow(curPx.x - firstPx.x, 2) + Math.pow(curPx.y - firstPx.y, 2))
        setNearStart(dist < CLOSE_THRESHOLD_PX)
      }
    }
  }, [drawing, drawPoints, latLngToPixel])

  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!drawing || !e.latLng) return
    const pt = { lat: e.latLng.lat(), lng: e.latLng.lng() }

    // Auto-close if clicking near start point
    if (drawPoints.length >= 3 && nearStart) {
      setPendingCoords(drawPoints)
      setDrawPoints([])
      setMousePos(null)
      setNearStart(false)
      setDrawing(false)
      return
    }

    setDrawPoints(prev => [...prev, pt])
  }, [drawing, drawPoints, nearStart])

  async function saveGeofence() {
    if (!pendingCoords || !geofenceName.trim()) return
    setSaving(true)
    await supabase.from('geofences').insert({
      name: geofenceName.trim(),
      coordinates: pendingCoords.map(p => [p.lat, p.lng]),
      active: true
    })
    setSaving(false)
    setPendingCoords(null)
    setGeofenceName('')
    onGeofenceCreated()
  }

  function startDrawing() {
    setDrawing(true)
    setDrawPoints([])
    setMousePos(null)
    setNearStart(false)
  }

  function cancelDrawing() {
    setDrawing(false)
    setDrawPoints([])
    setMousePos(null)
    setNearStart(false)
  }

  if (loadError) {
    return (
      <div className="map-error">
        <p>⚠️ Google Maps failed to load.</p>
        <a href="https://console.cloud.google.com/apis/library/maps-backend.googleapis.com" target="_blank" rel="noreferrer">Enable Maps JS API →</a>
      </div>
    )
  }

  if (!isLoaded) return <div className="map-loading">Loading map…</div>

  // Live preview line: drawn points + mouse position
  const previewPath = mousePos ? [...drawPoints, mousePos] : drawPoints

  // First point marker for visual close-target
  const firstPoint = drawPoints.length >= 3 ? drawPoints[0] : null

  return (
    <div className="map-container">
      <div className="map-toolbar">
        {!drawing ? (
          <button className="btn-draw" onClick={startDrawing}>✏️ Draw Geofence</button>
        ) : (
          <div className="draw-instructions">
            {drawPoints.length === 0
              ? 'Click to start drawing'
              : drawPoints.length < 3
              ? `${drawPoints.length} point${drawPoints.length > 1 ? 's' : ''} — keep going`
              : nearStart
              ? '🟢 Click to close shape'
              : `${drawPoints.length} points — click near start to close`}
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

      <GoogleMap
        mapContainerStyle={{ height: '100%', width: '100%' }}
        center={center}
        zoom={deviceWithLoc ? 17 : 16}
        options={{
          ...MAP_OPTIONS,
          draggableCursor: drawing ? PENCIL_CURSOR : undefined,
          draggingCursor: drawing ? PENCIL_CURSOR : undefined,
        }}
        onLoad={onMapLoad}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
      >
        {/* Saved geofences */}
        {geofences.map(gf => (
          <Polygon
            key={gf.id}
            paths={(gf.coordinates as [number, number][]).map(([lat, lng]) => ({ lat, lng }))}
            options={{ strokeColor: '#3b82f6', strokeOpacity: 0.9, strokeWeight: 2, fillColor: '#3b82f6', fillOpacity: 0.15 }}
          />
        ))}

        {/* Live drawing preview — polyline follows cursor */}
        {drawing && previewPath.length > 1 && (
          <Polyline
            path={previewPath}
            options={{
              strokeColor: nearStart ? '#10b981' : '#f59e0b',
              strokeOpacity: 0.9,
              strokeWeight: 2.5,
              strokeDasharray: '6 4',
            } as google.maps.PolylineOptions}
          />
        )}

        {/* Closing line back to first point when near start */}
        {drawing && nearStart && firstPoint && mousePos && (
          <Polyline
            path={[mousePos, firstPoint]}
            options={{ strokeColor: '#10b981', strokeOpacity: 0.9, strokeWeight: 2.5 } as google.maps.PolylineOptions}
          />
        )}

        {/* First point indicator — shows where to click to close */}
        {drawing && firstPoint && (
          <Marker
            position={firstPoint}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: nearStart ? 10 : 6,
              fillColor: nearStart ? '#10b981' : '#f59e0b',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2,
            }}
            onClick={handleMapClick as any}
          />
        )}

        {/* Completed pending geofence (not yet named) */}
        {pendingCoords && (
          <Polygon
            paths={pendingCoords}
            options={{ strokeColor: '#10b981', strokeOpacity: 0.9, strokeWeight: 2, fillColor: '#10b981', fillOpacity: 0.2 }}
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
                scale: 10,
                fillColor: '#ef4444',
                fillOpacity: 1,
                strokeColor: '#fff',
                strokeWeight: 2,
              } : {
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 6,
                rotation: loc.heading ?? 0,
                fillColor: '#22c55e',
                fillOpacity: 1,
                strokeColor: '#fff',
                strokeWeight: 2,
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
              Satellites: {selectedDevice.latestLocation.satellites ?? '—'}<br />
              Ignition: {selectedDevice.latestLocation.ignition ? 'ON' : 'OFF'}<br />
              <small>{new Date(selectedDevice.latestLocation.recorded_at).toLocaleString()}</small>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>
    </div>
  )
}
