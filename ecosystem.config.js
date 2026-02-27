module.exports = {
  apps: [
    {
      name: 'api-server',
      script: 'packages/server/dist/app.js',
      cwd: __dirname,
      instances: 1,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'bot-runner',
      script: 'packages/bot/dist/index.js',
      cwd: __dirname,
      instances: 1,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
