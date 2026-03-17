module.exports = {
  apps: [
    {
      name: 'minecraft-auto-bedrock',
      script: 'src/index.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 999999,
      min_uptime: '5s',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'minecraft-auto-bedrock-gui',
      script: 'gui/server.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 999999,
      min_uptime: '5s',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
