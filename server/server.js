/**
 * GT06 Protocol TCP Server for Jimi IoT VL802 GPS Trackers
 * 
 * GT06 Packet Format:
 *   Start: 0x78 0x78
 *   Length: 1 byte
 *   Protocol number: 1 byte
 *   Data: variable
 *   Serial number: 2 bytes
 *   Error check: 2 bytes (CRC16)
 *   End: 0x0D 0x0A
 */

const net = require('net')
const https = require('https')

const PORT = 5024
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qpmwjkcxfyreudexawpw.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbXdqa2N4ZnlyZXVkZXhhd3B3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU2MTQwNSwiZXhwIjoyMDk2MTM3NDA1fQ.R2zD0a-_2uW12EMQ2O_LBzJah0Cx9NulrJswpI1iQkI'

// CRC16/IBM (GT06 uses this)
function crc16(buf) {
  let crc = 0xFFFF
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] << 8
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) crc = (crc << 1) ^ 0x1021
      else crc <<= 1
      crc &= 0xFFFF
    }
  }
  return crc
}

// Supabase REST call
async function supabaseInsert(table, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const url = new URL(`/rest/v1/${table}`, SUPABASE_URL)
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=representation'
      }
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', d => raw += d)
      res.on('end', () => resolve({ status: res.statusCode, body: raw }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function supabaseUpsert(table, data, onConflict) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const url = new URL(`/rest/v1/${table}`, SUPABASE_URL)
    const options = {
      hostname: url.hostname,
      path: `${url.pathname}?on_conflict=${onConflict}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=representation'
      }
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', d => raw += d)
      res.on('end', () => resolve({ status: res.statusCode, body: raw }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function supabaseSelect(table, params) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/rest/v1/${table}`, SUPABASE_URL)
    const qs = new URLSearchParams(params).toString()
    const options = {
      hostname: url.hostname,
      path: `${url.pathname}?${qs}`,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', d => raw += d)
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch { resolve([]) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

// Parse GT06 login packet (protocol 0x01)
function parseLoginPacket(data) {
  // Data field contains 8-byte IMEI (BCD encoded)
  if (data.length < 8) return null
  const imeiBytes = data.slice(0, 8)
  let imei = ''
  for (const b of imeiBytes) {
    imei += ((b >> 4) & 0xF).toString()
    imei += (b & 0xF).toString()
  }
  // IMEI is 15 digits; the first byte high nibble is usually 0
  imei = imei.replace(/^0/, '').slice(0, 15)
  return imei
}

// Parse GT06 GPS packet (protocol 0x22 = location data)
function parseGpsPacket(data) {
  try {
    let offset = 0

    // Date/Time: year(1) month(1) day(1) hour(1) min(1) sec(1)
    const year = 2000 + data[offset++]
    const month = data[offset++]
    const day = data[offset++]
    const hour = data[offset++]
    const min = data[offset++]
    const sec = data[offset++]
    const recordedAt = new Date(Date.UTC(year, month - 1, day, hour, min, sec))

    // GPS info byte: satellites(4 bits high) + GPS data length(4 bits low)
    const gpsInfoByte = data[offset++]
    const satellites = (gpsInfoByte >> 4) & 0xF

    // Latitude: 4 bytes (degrees * 30000 / 60 format or direct degrees * 1,000,000)
    const latRaw = data.readUInt32BE(offset); offset += 4
    const lngRaw = data.readUInt32BE(offset); offset += 4

    // Convert: latitude = raw / (30000 * 60) in minutes, or raw / 1800000 in degrees
    let lat = latRaw / 1800000.0
    let lng = lngRaw / 1800000.0

    // Speed in km/h
    const speed = data[offset++]

    // Course + status: 2 bytes
    const courseStatus = data.readUInt16BE(offset); offset += 2
    const heading = courseStatus & 0x3FF
    
    // Status bits
    const isRealTime = !!(courseStatus & 0x2000)
    const isGpsValid = !!(courseStatus & 0x1000)
    const isEastLng = !!(courseStatus & 0x0800)
    const isNorthLat = !!(courseStatus & 0x0400)

    // Apply hemisphere
    if (!isNorthLat) lat = -lat
    if (!isEastLng) lng = -lng

    return {
      lat,
      lng,
      speed,
      heading,
      satellites,
      recorded_at: recordedAt.toISOString(),
      gps_valid: isGpsValid,
      real_time: isRealTime
    }
  } catch (e) {
    console.error('Error parsing GPS packet:', e.message)
    return null
  }
}

// Build GT06 login response
function buildLoginResponse(serialNumber) {
  // 0x78 0x78 | len=5 | proto=0x01 | serial(2) | crc(2) | 0x0D 0x0A
  const buf = Buffer.alloc(10)
  buf[0] = 0x78
  buf[1] = 0x78
  buf[2] = 0x05 // length
  buf[3] = 0x01 // protocol: login
  buf[4] = (serialNumber >> 8) & 0xFF
  buf[5] = serialNumber & 0xFF
  const crc = crc16(buf.slice(2, 6))
  buf[6] = (crc >> 8) & 0xFF
  buf[7] = crc & 0xFF
  buf[8] = 0x0D
  buf[9] = 0x0A
  return buf
}

// Store device IMEI → device_id cache
const deviceCache = new Map()

async function getOrCreateDevice(imei) {
  if (deviceCache.has(imei)) return deviceCache.get(imei)

  // Try to find existing device
  const existing = await supabaseSelect('devices', { imei: `eq.${imei}`, select: 'id,imei,name' })
  if (existing && existing.length > 0) {
    deviceCache.set(imei, existing[0])
    return existing[0]
  }

  // Create new device
  const result = await supabaseUpsert('devices', { imei, name: `Tracker ${imei.slice(-4)}` }, 'imei')
  try {
    const created = JSON.parse(result.body)
    const device = Array.isArray(created) ? created[0] : created
    deviceCache.set(imei, device)
    console.log(`[NEW DEVICE] IMEI: ${imei}, ID: ${device?.id}`)
    return device
  } catch {
    return null
  }
}

function parsePackets(buffer) {
  const packets = []
  let offset = 0

  while (offset < buffer.length - 4) {
    // Find start bytes 0x78 0x78
    if (buffer[offset] !== 0x78 || buffer[offset + 1] !== 0x78) {
      offset++
      continue
    }

    if (offset + 3 >= buffer.length) break

    const length = buffer[offset + 2]
    const totalLen = length + 5 // start(2) + len(1) + data(length) + end(2)

    if (offset + totalLen > buffer.length) break

    const packet = buffer.slice(offset, offset + totalLen)
    packets.push(packet)
    offset += totalLen
  }

  return packets
}

// Handle a connected client
function handleClient(socket) {
  const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`
  console.log(`[CONNECT] ${remoteAddr}`)

  let imei = null
  let deviceId = null
  let buffer = Buffer.alloc(0)

  socket.on('data', async (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    const packets = parsePackets(buffer)
    // Reset buffer (simplified — in production track consumed bytes)
    buffer = Buffer.alloc(0)

    for (const packet of packets) {
      const protocolNum = packet[3]
      const dataStart = 4
      const dataEnd = packet.length - 6 // exclude serial(2), crc(2), end(2)
      const data = packet.slice(dataStart, dataEnd)
      const serialNumber = packet.readUInt16BE(packet.length - 6)

      console.log(`[PACKET] ${remoteAddr} proto=0x${protocolNum.toString(16).padStart(2,'0')} len=${packet.length}`)

      if (protocolNum === 0x01) {
        // Login packet
        imei = parseLoginPacket(data)
        if (!imei) {
          console.warn(`[WARN] Could not parse IMEI from ${remoteAddr}`)
          continue
        }
        console.log(`[LOGIN] IMEI: ${imei} from ${remoteAddr}`)
        const device = await getOrCreateDevice(imei)
        deviceId = device?.id
        const response = buildLoginResponse(serialNumber)
        socket.write(response)

      } else if (protocolNum === 0x22 || protocolNum === 0x10) {
        // GPS location packet (0x22 = extended, 0x10 = standard)
        if (!imei) {
          console.warn(`[WARN] GPS packet before login from ${remoteAddr}`)
          continue
        }

        const gps = parseGpsPacket(data)
        if (!gps || !gps.gps_valid) {
          console.log(`[GPS] Invalid fix from ${imei}`)
          continue
        }

        console.log(`[GPS] ${imei} lat=${gps.lat.toFixed(6)} lng=${gps.lng.toFixed(6)} spd=${gps.speed}km/h`)

        const locationRecord = {
          device_id: deviceId,
          imei,
          lat: gps.lat,
          lng: gps.lng,
          speed: gps.speed,
          heading: gps.heading,
          satellites: gps.satellites,
          battery: null, // VL802 may send in separate packet
          ignition: null,
          raw_packet: packet.toString('hex'),
          recorded_at: gps.recorded_at
        }

        const res = await supabaseInsert('locations', locationRecord)
        if (res.status === 201) {
          console.log(`[SAVED] Location for ${imei}`)
        } else {
          console.error(`[ERROR] Save failed: ${res.status} ${res.body}`)
        }

      } else if (protocolNum === 0x13) {
        // Heartbeat packet — acknowledge
        const response = Buffer.from([0x78, 0x78, 0x05, 0x13,
          (serialNumber >> 8) & 0xFF, serialNumber & 0xFF,
          0x00, 0x00, 0x0D, 0x0A])
        // Recalculate CRC for heartbeat response
        const crc = crc16(response.slice(2, 6))
        response[6] = (crc >> 8) & 0xFF
        response[7] = crc & 0xFF
        socket.write(response)
        console.log(`[HEARTBEAT] ${imei || remoteAddr}`)
      } else {
        console.log(`[UNKNOWN] Protocol 0x${protocolNum.toString(16)} from ${remoteAddr}`)
      }
    }
  })

  socket.on('close', () => {
    console.log(`[DISCONNECT] ${imei || remoteAddr}`)
  })

  socket.on('error', (err) => {
    console.error(`[ERROR] ${remoteAddr}: ${err.message}`)
  })

  socket.setTimeout(300000) // 5 min timeout
  socket.on('timeout', () => {
    console.log(`[TIMEOUT] ${imei || remoteAddr}`)
    socket.destroy()
  })
}

const server = net.createServer(handleClient)

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n⛳ Golf Chariots Fleet TCP Server`)
  console.log(`   GT06 Protocol | Port: ${PORT}`)
  console.log(`   Supabase: ${SUPABASE_URL}`)
  console.log(`   Ready for VL802 connections\n`)
})

server.on('error', (err) => {
  console.error(`Server error: ${err.message}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...')
  server.close(() => process.exit(0))
})
