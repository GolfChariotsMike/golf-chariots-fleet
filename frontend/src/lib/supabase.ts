import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

export interface Device {
  id: string
  imei: string
  name: string | null
  created_at: string
}

export interface Location {
  id: string
  device_id: string
  imei: string
  lat: number
  lng: number
  speed: number | null
  heading: number | null
  satellites: number | null
  battery: number | null
  ignition: boolean | null
  raw_packet: string | null
  recorded_at: string
  created_at: string
}

export interface Geofence {
  id: string
  name: string
  coordinates: [number, number][]
  active: boolean
  created_at: string
}

export interface GeofenceAlert {
  id: string
  device_id: string
  geofence_id: string
  alert_type: 'enter' | 'exit'
  location: { lat: number; lng: number } | null
  created_at: string
}
