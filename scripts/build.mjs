import { cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const distDir = resolve(rootDir, 'dist');

async function buildPages() {
  await build({
    configFile: false,
    root: rootDir,
    build: {
      outDir: distDir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(rootDir, 'popup.html'),
          sidepanel: resolve(rootDir, 'sidepanel.html'),
          options: resolve(rootDir, 'options.html')
        },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      }
    }
  });
}

async function buildBackground() {
  await build({
    configFile: false,
    root: rootDir,
    build: {
      outDir: distDir,
      emptyOutDir: false,
      lib: {
        entry: resolve(rootDir, 'src/background/index.ts'),
        formats: ['es'],
        fileName: () => 'background.js'
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true
        }
      }
    }
  });
}

async function buildContent() {
  await build({
    configFile: false,
    root: rootDir,
    build: {
      outDir: distDir,
      emptyOutDir: false,
      lib: {
        entry: resolve(rootDir, 'src/content/axureZoom.ts'),
        formats: ['iife'],
        name: 'AxureScaleContent',
        fileName: () => 'content.js'
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true
        }
      }
    }
  });
}

async function main() {
  await buildPages();
  await buildBackground();
  await buildContent();
  cpSync(resolve(rootDir, 'src/manifest.json'), resolve(distDir, 'manifest.json'));
  cpSync(resolve(rootDir, 'src/icons'), resolve(distDir, 'icons'), { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
