import { useEffect, useState, useCallback } from 'react'
import { supabase } from './lib/supabase'
import type { Device, Location, Geofence, GeofenceAlert } from './lib/supabase'
import { pointInPolygon } from './lib/geofence'
import DeviceSidebar from './components/DeviceSidebar'
import FleetMap from './components/FleetMap'
import './App.css'

interface DeviceWithLocation extends Device {
  latestLocation?: Location
  hasAlert?: boolean
}

export default function App() {
  const [devices, setDevices] = useState<DeviceWithLocation[]>([])
  const [geofences, setGeofences] = useState<Geofence[]>([])
  const [alerts, setAlerts] = useState<GeofenceAlert[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())

  const checkGeofences = useCallback(async (updatedDevices: DeviceWithLocation[], currentGeofences: Geofence[]) => {
    const activeGeofences = currentGeofences.filter(g => g.active)
    const newAlerts: Omit<GeofenceAlert, 'id' | 'created_at'>[] = []

    for (const device of updatedDevices) {
      if (!device.latestLocation) continue
      const loc = device.latestLocation
      const point: [number, number] = [loc.lat, loc.lng]

      for (const gf of activeGeofences) {
        const inside = pointInPolygon(point, gf.coordinates)
        if (!inside) {
          // Device is outside geofence — record exit alert
          newAlerts.push({
            device_id: device.id,
            geofence_id: gf.id,
            alert_type: 'exit',
            location: { lat: loc.lat, lng: loc.lng }
          })
          device.hasAlert = true
        }
      }
    }

    if (newAlerts.length > 0) {
      await supabase.from('geofence_alerts').insert(newAlerts)
    }
  }, [])

  const fetchData = useCallback(async () => {
    // Fetch devices
    const { data: devicesData } = await supabase
      .from('devices')
      .select('*')
      .order('created_at', { ascending: true })

    if (!devicesData) return

    // Fetch latest location per device
    const deviceList: DeviceWithLocation[] = await Promise.all(
      devicesData.map(async (device: Device) => {
        const { data: loc } = await supabase
          .from('locations')
          .select('*')
          .eq('device_id', device.id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .single()
        return { ...device, latestLocation: loc || undefined, hasAlert: false }
      })
    )

    setDevices(deviceList)
    setLastUpdate(new Date())

    // Fetch geofences
    const { data: gfData } = await supabase
      .from('geofences')
      .select('*')
      .eq('active', true)
    const gfs = gfData || []
    setGeofences(gfs)

    // Check geofence violations
    await checkGeofences(deviceList, gfs)

    // Fetch recent alerts
    const { data: alertsData } = await supabase
      .from('geofence_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    setAlerts(alertsData || [])
  }, [checkGeofences])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 15000) // refresh every 15s
    return () => clearInterval(interval)
  }, [fetchData])

  // Real-time subscription to new locations
  useEffect(() => {
    const channel = supabase
      .channel('locations-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'locations' }, () => {
        fetchData()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchData])

  return (
    <div className="app">
      <DeviceSidebar
        devices={devices}
        alerts={alerts}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={setSelectedDeviceId}
        onDeviceAdded={fetchAll}
      />
      <div className="main">
        <div className="status-bar">
          <span>Live GPS Fleet Tracking</span>
          <span className="update-time">Last updated: {lastUpdate.toLocaleTimeString()}</span>
        </div>
        <FleetMap
          devices={devices}
          geofences={geofences}
          selectedDeviceId={selectedDeviceId}
          onGeofenceCreated={fetchData}
        />
      </div>
    </div>
  )
}
