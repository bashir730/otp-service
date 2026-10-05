/**
 * PM2 configuration for otp-service
 * Usage:
 *   npm run build
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup   # enable boot start
 */
module.exports = {
  apps: [
    {
      name: 'otp-service',
      script: 'dist/server.js',
      cwd: __dirname,
      instances: 1,          // single instance: one WhatsApp session
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      kill_timeout: 10000,   // give graceful shutdown 10s
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
