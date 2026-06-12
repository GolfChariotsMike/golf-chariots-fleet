import { useState, useCallback, useRef } from 'react'
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Polygon,
  InfoWindow,
} from '@react-google-maps/api'
import { supabase } from '../lib/supabase'
import type { Device, Location, Geofence } from '../lib/supabase'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string

// Links Kennedy Bay Golf Course, Port Kennedy WA
const DEFAULT_CENTER = { lat: -32.3686, lng: 115.7556 }

const MAP_OPTIONS: google.maps.MapOptions = {
  mapTypeId: 'satellite',
  tilt: 0,
  mapTypeControl: true,
  mapTypeControlOptions: {
    style: 2, // DROPDOWN_MENU
    position: 3, // TOP_RIGHT
  },
  streetViewControl: false,
  fullscreenControl: true,
  zoomControl: true,
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
  })

  const [drawing, setDrawing] = useState(false)
  const [drawPoints, setDrawPoints] = useState<google.maps.LatLngLiteral[]>([])
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

  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!drawing || !e.latLng) return
    setDrawPoints(prev => [...prev, { lat: e.latLng!.lat(), lng: e.latLng!.lng() }])
  }, [drawing])

  const handleMapDblClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!drawing || !e.latLng) return
    const finalPoints = [...drawPoints, { lat: e.latLng.lat(), lng: e.latLng.lng() }]
    if (finalPoints.length >= 3) {
      setPendingCoords(finalPoints)
      setDrawPoints([])
      setDrawing(false)
    }
  }, [drawing, drawPoints])

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

  if (loadError) {
    return (
      <div className="map-error">
        <p>⚠️ Google Maps failed to load.</p>
        <p>You may need to enable the <strong>Maps JavaScript API</strong> in Google Cloud Console for key ending in <code>…Av9o</code></p>
        <a href="https://console.cloud.google.com/apis/library/maps-backend.googleapis.com" target="_blank" rel="noreferrer">
          Enable it here →
        </a>
      </div>
    )
  }

  if (!isLoaded) {
    return <div className="map-loading">Loading map…</div>
  }

  return (
    <div className="map-container">
      <div className="map-toolbar">
        {!drawing ? (
          <button className="btn-draw" onClick={() => { setDrawing(true); setDrawPoints([]) }}>
            ✏️ Draw Geofence
          </button>
        ) : (
          <div className="draw-instructions">
            Click to add points • Double-click to finish ({drawPoints.length} points)
            <button className="btn-cancel" onClick={() => { setDrawing(false); setDrawPoints([]) }}>Cancel</button>
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
        options={MAP_OPTIONS}
        onLoad={onMapLoad}
        onClick={handleMapClick}
        onDblClick={handleMapDblClick}
      >
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

        {/* In-progress geofence drawing */}
        {drawPoints.length > 1 && (
          <Polygon
            paths={drawPoints}
            options={{
              strokeColor: '#f59e0b',
              strokeOpacity: 0.9,
              strokeWeight: 2,
              fillColor: '#f59e0b',
              fillOpacity: 0.2,
            }}
          />
        )}

        {/* Pending (drawn, not yet named) geofence */}
        {pendingCoords && (
          <Polygon
            paths={pendingCoords}
            options={{
              strokeColor: '#10b981',
              strokeOpacity: 0.9,
              strokeWeight: 2,
              fillColor: '#10b981',
              fillOpacity: 0.2,
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

        {/* Info window for selected device */}
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
