# Golf Chariots Fleet Tracker

GPS fleet tracking for Golf Chariots / MIROJO using Jimi IoT VL802 trackers.

## Architecture

```
VL802 Device → TCP Server (GT06) → Supabase → React Dashboard
```

## Components

### TCP Server (`/server`)
- Node.js TCP server on port **5024**
- Parses GT06 protocol (login + GPS packets)
- Auto-creates device records in Supabase on first connection
- Posts location data to Supabase REST API

### Frontend (`/frontend`)
- React + Vite + TypeScript
- Live map with Leaflet + OpenStreetMap (no API key needed)
- Device sidebar with live status
- Geofence drawing tool (polygon)
- Real-time updates via Supabase Realtime

## Setup

### 1. Run the SQL in Supabase
See `SQL.md` — run in the Supabase dashboard SQL editor.

### 2. Start the TCP Server (on your VPS)
```bash
cd server
npm install
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # auto-start on reboot
```

### 3. Configure your VL802 tracker
Set the server IP and port in the tracker settings:
- **Server IP:** your VPS IP
- **Port:** 5024
- **Protocol:** GT06

### 4. Frontend
Deployed to Vercel automatically on push to main.

## Environment Variables (Vercel)
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon/service key
