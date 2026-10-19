import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// /api 转发目标：开发默认本机 3000；单机部署（vite preview）时用 API_PROXY_TARGET 指定
const apiProxy = {
  '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 开发时把 /api 转发到本地服务端，与生产环境 Nginx 的同源部署方式一致
    proxy: apiProxy,
  },
  preview: { proxy: apiProxy },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // 第三方库单独打包，业务代码更新时浏览器可继续使用缓存
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          antd: ['antd', '@ant-design/icons', 'dayjs'],
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
