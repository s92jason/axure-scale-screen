import { copyFileSync, cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { pendingRelease } from './release-lib.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const distDir = resolve(rootDir, 'dist');
const chromeDistDir = resolve(rootDir, 'AxureScaleScreen-extention');
const safariHandlerSource = resolve(rootDir, 'src/safari-native/SafariWebExtensionHandler.swift');
const safariHandlerTarget = resolve(rootDir, 'safari-app/AxureScaleScreen/Shared (Extension)/SafariWebExtensionHandler.swift');

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

// Safari 自動備份的原生程式：Xcode 專案不進版，build 時把版控中的 handler 同步進既有專案，
// 更新流程維持「npm run build → Xcode Run」。尚未轉換出專案時略過；內容相同就不寫，避免 Xcode 無謂重編。
function syncSafariHandler() {
  if (!existsSync(dirname(safariHandlerTarget))) {
    return;
  }
  const source = readFileSync(safariHandlerSource);
  if (existsSync(safariHandlerTarget) && readFileSync(safariHandlerTarget).equals(source)) {
    return;
  }
  copyFileSync(safariHandlerSource, safariHandlerTarget);
  console.log(`已同步 Safari 原生程式：${relative(rootDir, safariHandlerTarget)}`);
}

async function main() {
  await buildPages();
  await buildBackground();
  await buildContent();
  cpSync(resolve(rootDir, 'src/manifest.json'), resolve(distDir, 'manifest.json'));
  cpSync(resolve(rootDir, 'src/icons'), resolve(distDir, 'icons'), { recursive: true, force: true });
  cpSync(resolve(rootDir, 'src/_locales'), resolve(distDir, '_locales'), { recursive: true, force: true });
  // Chrome 固定載入此資料夾；完整更新可移除過期的 hash 資產與語系檔案。
  rmSync(chromeDistDir, { recursive: true, force: true });
  cpSync(distDir, chromeDistDir, { recursive: true, force: true });
  console.log(`Chrome 建置輸出：${chromeDistDir}`);
  syncSafariHandler();
  // 開發完常忘了進版：有尚未進版的 feat/fix 時提醒一行，不擋建置。
  const pending = pendingRelease(rootDir);
  if (pending && pending.count > 0) {
    console.log(`提醒：自 ${pending.version} 以來有 ${pending.count} 個使用者可見的 commit 尚未進版，完成開發後執行 npm run release`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
