module.exports = {
  apps: [{
    name: 'golf-chariots-gps',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://qpmwjkcxfyreudexawpw.supabase.co',
      SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbXdqa2N4ZnlyZXVkZXhhd3B3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU2MTQwNSwiZXhwIjoyMDk2MTM3NDA1fQ.REDACTED'
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true
  }]
}
