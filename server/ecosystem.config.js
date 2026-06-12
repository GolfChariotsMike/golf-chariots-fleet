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
      SUPABASE_KEY: process.env.SUPABASE_KEY || ''
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true
  }]
}
