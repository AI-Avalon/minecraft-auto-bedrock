module.exports = {
  apps: [
    {
      name: 'minecraft-auto-bedrock',
      script: 'src/index.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '5s',
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
