/**
 * PM2 进程配置（可选部署方式之一）。
 * 用法：
 *   pm2 start deploy/pm2.config.cjs
 *   pm2 save && pm2 startup      # 开机自启
 *   pm2 logs kanban-pulse
 *
 * 注意：应用使用单文件 JSON 存储，必须保持单实例 fork 模式，禁止 cluster。
 */
module.exports = {
  apps: [
    {
      name: 'kanban-pulse',
      script: 'server/index.js',
      cwd: __dirname + '/..',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 4173,
        SEED_MODE: 'empty',
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
