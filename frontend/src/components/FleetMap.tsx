import { useState, useCallback, useRef } from 'react'
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Polygon,
  InfoWindow,
  DrawingManager,
} from '@react-google-maps/api'
import { supabase } from '../lib/supabase'
import type { Device, Location, Geofence } from '../lib/supabase'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string
const LIBRARIES: ('drawing')[] = ['drawing']

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
  disableDoubleClickZoom: false,
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

export default function FleetMap({ devices, geofences, onGeofenceCreated }: Props) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  })

  const [drawing, setDrawing] = useState(false)
  const [pendingPolygon, setPendingPolygon] = useState<google.maps.Polygon | null>(null)
  const [pendingCoords, setPendingCoords] = useState<google.maps.LatLngLiteral[] | null>(null)
  const [geofenceName, setGeofenceName] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedDevice, setSelectedDevice] = useState<DeviceWithLocation | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)

  const deviceWithLoc = devices.find(d => d.latestLocation)
  const center = deviceWithLoc?.latestLocation
    ? { lat: deviceWithLoc.latestLocation.lat, lng: deviceWithLoc.latestLocation.lng }
    : DEFAULT_CENTER

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map
  }, [])

  const onPolygonComplete = useCallback((polygon: google.maps.Polygon) => {
    const path = polygon.getPath()
    const coords: google.maps.LatLngLiteral[] = []
    for (let i = 0; i < path.getLength(); i++) {
      const pt = path.getAt(i)
      coords.push({ lat: pt.lat(), lng: pt.lng() })
    }
    setPendingPolygon(polygon)
    setPendingCoords(coords)
    setDrawing(false)
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
    pendingPolygon?.setMap(null)
    setPendingPolygon(null)
    setPendingCoords(null)
    setGeofenceName('')
    onGeofenceCreated()
  }

  function discardPending() {
    pendingPolygon?.setMap(null)
    setPendingPolygon(null)
    setPendingCoords(null)
    setGeofenceName('')
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

  return (
    <div className="map-container">
      <div className="map-toolbar">
        {!drawing ? (
          <button className="btn-draw" onClick={() => setDrawing(true)}>✏️ Draw Geofence</button>
        ) : (
          <div className="draw-instructions">
            Click to add points • Click first point to close
            <button className="btn-cancel" onClick={() => setDrawing(false)}>Cancel</button>
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
              <button onClick={discardPending}>Discard</button>
            </div>
          </div>
        </div>
      )}

      <GoogleMap
        mapContainerStyle={{ height: '100%', width: '100%' }}
        center={center}
        zoom={deviceWithLoc ? 17 : 16}
        options={MAP_OPTIONS}
        onLoad={onMapLoad}
      >
        {drawing && (
          <DrawingManager
            drawingMode={google.maps.drawing.OverlayType.POLYGON}
            onPolygonComplete={onPolygonComplete}
            options={{
              drawingControl: false,
              polygonOptions: {
                strokeColor: '#f59e0b',
                strokeOpacity: 0.9,
                strokeWeight: 2,
                fillColor: '#f59e0b',
                fillOpacity: 0.2,
                editable: false,
              },
            }}
          />
        )}

        {/* Saved geofences */}
        {geofences.map(gf => (
          <Polygon
            key={gf.id}
            paths={(gf.coordinates as [number, number][]).map(([lat, lng]) => ({ lat, lng }))}
            options={{
              strokeColor: '#3b82f6',
              strokeOpacity: 0.9,
              strokeWeight: 2,
              fillColor: '#3b82f6',
              fillOpacity: 0.15,
            }}
          />
        ))}

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
