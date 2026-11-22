import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 8000,
    // Emit one JS bundle instead of ~120 lazy chunks: a handful of files is easy to upload
    // through Cloudflare Pages "Upload assets" and avoids waterfall requests.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
