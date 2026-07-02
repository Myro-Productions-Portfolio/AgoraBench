module.exports = {
  apps: [
    {
      name: 'agora-bench',
      script: './start-server.sh',
      interpreter: '/bin/sh',
      cwd: '/Volumes/DevDrive-M4Pro/Projects/AgoraBench',
      watch: false,
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
