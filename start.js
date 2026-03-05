#!/usr/bin/env node

/* eslint-disable no-console,@typescript-eslint/no-var-requires */
const http = require('http');
const path = require('path');
const fs = require('fs');

/**
 * 1. 动态生成 Manifest
 * 确保在服务器启动前完成，以便静态资源可以被正确识别
 */
function generateManifest() {
  console.log('[Setup] 正在为 Docker 环境生成 manifest.json...');
  try {
    // 使用相对当前脚本的绝对路径，防止在不同目录下执行导致找不到文件
    const generateManifestScript = path.resolve(__dirname, 'scripts', 'generate-manifest.js');
    
    if (fs.existsSync(generateManifestScript)) {
      require(generateManifestScript);
      console.log('[Setup] manifest.json 生成成功');
    } else {
      console.error('[Error] 未找到 generate-manifest.js 脚本，跳过生成');
    }
  } catch (error) {
    console.error('[Error] 执行 generate-manifest.js 失败:', error.message);
    // 关键错误可以考虑 process.exit(1)，但在内网环境下通常建议跳过继续启动
  }
}

// 执行生成逻辑
generateManifest();

/**
 * 2. 启动 Next.js Standalone Server
 * 注意：require('./server.js') 会接管当前进程
 */
const PORT = process.env.PORT || 3000;
console.log(`[Server] 正在启动 Next.js Standalone Server，端口: ${PORT}...`);

try {
  // 启动服务器
  require('./server.js');
} catch (err) {
  console.error('[Error] 无法启动服务器:', err);
  process.exit(1);
}

/**
 * 3. 健康检查与 Cron 任务轮询
 * 在 Docker 内部，使用 127.0.0.1 访问自身是最稳健的
 */
const INTERNAL_URL = `http://127.0.0.1:${PORT}`;
const HEALTH_CHECK_PATH = '/login'; // 或者如果你有 /api/health 更佳

let isServerUp = false;

const pollServer = setInterval(() => {
  if (isServerUp) return;

  const req = http.get(`${INTERNAL_URL}${HEALTH_CHECK_PATH}`, (res) => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      console.log(`[Health] 服务器已就绪 (Status: ${res.statusCode})`);
      isServerUp = true;
      clearInterval(pollServer);

      // 服务器就绪后 5 秒执行第一次 Cron
      setTimeout(executeCronJob, 5000);

      // 随后每小时执行一次
      setInterval(executeCronJob, 60 * 60 * 1000);
    }
  });

  req.on('error', () => {
    // 忽略连接失败，因为服务器可能还没初始化完成
  });

  req.setTimeout(1000, () => {
    req.destroy();
  });
}, 2000);

/**
 * 4. 执行 Cron 任务函数
 */
function executeCronJob() {
  const cronUrl = `${INTERNAL_URL}/api/cron`;
  console.log(`[Cron] 正在触发定时任务: ${cronUrl}`);

  const req = http.get(cronUrl, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('[Cron] 任务执行成功:', data);
      } else {
        console.warn(`[Cron] 任务返回非 2xx 状态码: ${res.statusCode}`);
      }
    });
  });

  req.on('error', (err) => {
    console.error('[Cron] 触发失败:', err.message);
  });

  req.setTimeout(60000, () => { // 给 Cron 任务一分钟响应时间
    console.error('[Cron] 请求超时');
    req.destroy();
  });
}
