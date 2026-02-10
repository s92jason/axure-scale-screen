import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL('./popup.html', import.meta.url)),
        background: fileURLToPath(new URL('./src/background/index.ts', import.meta.url)),
        content: fileURLToPath(new URL('./src/content/axureZoom.ts', import.meta.url))
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }
          if (chunkInfo.name === 'content') {
            return 'content.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
