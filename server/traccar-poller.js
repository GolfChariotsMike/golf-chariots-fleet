/**
 * Traccar → Supabase poller
 * Polls Traccar API every 10s and upserts device positions into Supabase
 */

const http = require('http')
const https = require('https')

const TRACCAR_HOST = '207.148.12.250'
const TRACCAR_PORT = 8082
const TRACCAR_USER = 'golfchariots@gmail.com'
const TRACCAR_PASS = 'Mike1985'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qpmwjkcxfyreudexawpw.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbXdqa2N4ZnlyZXVkZXhhd3B3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU2MTQwNSwiZXhwIjoyMDk2MTM3NDA1fQ.R2zD0a-_2uW12EMQ2O_LBzJah0Cx9NulrJswpI1iQkI'

let sessionCookie = null

function traccarRequest(path, cookie) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: TRACCAR_HOST,
      port: TRACCAR_PORT,
      path,
      method: 'GET',
      headers: cookie ? { Cookie: cookie } : {}
    }
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        try { resolve({ data: JSON.parse(data), headers: res.headers }) }
        catch(e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function traccarLogin() {
  return new Promise((resolve, reject) => {
    const body = `email=${encodeURIComponent(TRACCAR_USER)}&password=${encodeURIComponent(TRACCAR_PASS)}`
    const options = {
      hostname: TRACCAR_HOST,
      port: TRACCAR_PORT,
      path: '/api/session',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Login failed: ${res.statusCode}`))
        const cookie = res.headers['set-cookie']?.map(c => c.split(';')[0]).join('; ')
        resolve(cookie)
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function supabaseUpsert(table, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const url = new URL(`/rest/v1/${table}`, SUPABASE_URL)
    const options = {
      hostname: url.hostname,
      path: url.pathname + '?on_conflict=imei',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      }
    }
    const req = https.request(options, (res) => {
      res.on('data', () => {})
      res.on('end', () => resolve())
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function poll() {
  try {
    if (!sessionCookie) {
      console.log('[Traccar] Logging in...')
      sessionCookie = await traccarLogin()
      console.log('[Traccar] Logged in')
    }

    const { data: positions } = await traccarRequest('/api/positions', sessionCookie)
    const { data: devices } = await traccarRequest('/api/devices', sessionCookie)

    const deviceMap = {}
    devices.forEach(d => deviceMap[d.id] = d)

    for (const pos of positions) {
      const device = deviceMap[pos.deviceId]
      if (!device) continue

      const record = {
        imei: device.uniqueId,
        name: device.name,
        lat: pos.latitude,
        lng: pos.longitude,
        speed: pos.speed,
        course: pos.course,
        ignition: pos.attributes?.ignition || false,
        battery: pos.attributes?.batteryLevel || null,
        signal: pos.attributes?.rssi || null,
        fix_time: pos.fixTime,
        server_time: pos.serverTime,
        valid: pos.valid,
        updated_at: new Date().toISOString()
      }

      await supabaseUpsert('gps_devices', record)
      console.log(`[Traccar] Updated ${device.name} (${device.uniqueId}) → lat:${pos.latitude.toFixed(5)} lng:${pos.longitude.toFixed(5)} speed:${pos.speed}km/h`)
    }
  } catch (err) {
    console.error('[Traccar] Poll error:', err.message)
    if (err.message.includes('401') || err.message.includes('Login')) {
      sessionCookie = null // Force re-login next poll
    }
  }
}

console.log('[Traccar Poller] Starting — polling every 10s')
poll()
setInterval(poll, 10000)
