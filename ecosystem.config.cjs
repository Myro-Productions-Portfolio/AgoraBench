module.exports = {
  apps: [
    {
      name: 'molt-government',
      script: './start-server.sh',
      interpreter: '/bin/sh',
      cwd: '/Volumes/DevDrive-M4Pro/Projects/Molt-Goverment',
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
