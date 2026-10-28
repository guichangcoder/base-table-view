import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// 飞书多维表格插件运行在 iframe 中，资源必须用相对路径，否则打包后加载不到。
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    // Semi UI 新版 package.json 的 exports 未暴露全局样式子路径，用 alias 直接映射到实际 CSS。
    alias: {
      '@douyinfe/semi-ui/dist/css/semi.min.css': fileURLToPath(
        new URL('node_modules/@douyinfe/semi-ui/dist/css/semi.min.css', import.meta.url)
      ),
    },
  },
  server: {
    host: true,
    port: 8848,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    // 正式发布必须从空目录产出，避免历史哈希资源残留。
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2019',
  },
});