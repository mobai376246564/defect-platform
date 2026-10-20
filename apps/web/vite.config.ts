import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// /api 转发目标：开发默认本机 3000；单机部署（vite preview）时用 API_PROXY_TARGET 指定
const apiProxy = {
  '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: true },
};

/** 构建时的代码版本，页面据此判断服务端是否已更新到新版本、需要刷新 */
function buildCommit(): string {
  if (process.env.APP_COMMIT) return process.env.APP_COMMIT;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __APP_COMMIT__: JSON.stringify(buildCommit()) },
  server: {
    port: 5173,
    // 开发时把 /api 转发到本地服务端，与生产环境 Nginx 的同源部署方式一致
    proxy: apiProxy,
  },
  preview: { proxy: apiProxy },
  build: {
    outDir: 'dist',
    // 生成 sourcemap 但不在 js 里引用（排查线上问题时可用），nginx 也不对外提供 .map 文件
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // 第三方库单独打包，业务代码更新时浏览器可继续使用缓存；
        // 图表库只有报表页用，单独一个包，按需加载
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined;
          if (/\/node_modules\/(echarts|zrender)\//.test(id)) return 'echarts';
          if (
            /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@tanstack)\//.test(
              id,
            )
          )
            return 'react';
          if (/\/node_modules\/(antd|@ant-design|rc-[^/]+|@rc-component|dayjs)\//.test(id))
            return 'antd';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
