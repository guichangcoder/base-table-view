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
    rollupOptions: {
      output: {
        // 把体积最大、版本稳定的第三方库拆成独立 chunk：首屏可并行下载、跨版本可复用缓存。
        // 只拆明确的几个大包，其余交给 Rollup 默认策略，避免破坏 RenderMarkDown 等按需加载。
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // RenderMarkDown 是 SDK 内部动态 import 的富文本渲染模块（约 160KB），
          // 必须留给 Rollup 做按需拆分，不能并入首屏的 vendor-lark。
          if (id.includes('RenderMarkDown')) return undefined;
          if (id.includes('lottie-web')) return 'vendor-lottie';
          if (id.includes('@lark-base-open')) return 'vendor-lark';
          if (id.includes('@douyinfe')) return 'vendor-semi';
          return undefined;
        },
      },
    },
  },
});