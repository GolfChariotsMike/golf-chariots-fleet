# Supabase SQL Setup

Run these in the Supabase dashboard SQL editor for project: **tate-outreach** (qpmwjkcxfyreudexawpw)

```sql
-- Devices table
create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  imei text unique not null,
  name text,
  created_at timestamptz default now()
);

-- Location history
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references devices(id),
  imei text not null,
  lat double precision not null,
  lng double precision not null,
  speed numeric,
  heading numeric,
  satellites integer,
  battery numeric,
  ignition boolean,
  raw_packet text,
  recorded_at timestamptz not null,
  created_at timestamptz default now()
);

-- Index for fast device location lookup
create index if not exists idx_locations_device_recorded 
  on locations(device_id, recorded_at desc);

create index if not exists idx_locations_imei 
  on locations(imei, recorded_at desc);

-- Geofences
create table if not exists geofences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  coordinates jsonb not null, -- array of [lat, lng] pairs
  active boolean default true,
  created_at timestamptz default now()
);

-- Geofence alerts
create table if not exists geofence_alerts (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references devices(id),
  geofence_id uuid references geofences(id),
  alert_type text not null, -- 'exit' or 'enter'
  location jsonb,
  created_at timestamptz default now()
);

-- Enable Row Level Security (optional but recommended)
-- For now, allow all since we use service role key
alter table devices enable row level security;
alter table locations enable row level security;
alter table geofences enable row level security;
alter table geofence_alerts enable row level security;

-- Allow service role full access (already works by default)
-- If you add auth, add appropriate policies here

-- Realtime (for live map updates)
alter publication supabase_realtime add table locations;
```

## Notes
- The TCP server auto-creates device records on first login
- Geofences are drawn via the web dashboard and saved to Supabase
- Location data streams in real-time via Supabase Realtime subscription
