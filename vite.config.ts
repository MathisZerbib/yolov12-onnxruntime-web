import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { envWriterPlugin } from './scripts/env-writer-plugin.mjs';

const onnxRuntimeAssetPattern = /^ort-wasm.*\.(?:mjs|wasm)$/;

function onnxRuntimeAssetsPlugin() {
  const onnxDir = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist');
  const serveAsset = (url: string, res: import('http').ServerResponse, next: () => void) => {
    const filename = decodeURIComponent(url.split('?')[0].slice('/ort-wasm/'.length));
    if (!onnxRuntimeAssetPattern.test(filename)) return next();
    const filePath = path.join(onnxDir, filename);
    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) return next();
      res.writeHead(200, {
        'Content-Type': filename.endsWith('.wasm') ? 'application/wasm' : 'application/javascript',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  };

  return {
    name: 'crossflow-onnx-runtime-assets',
    configureServer(server: { middlewares: { use: (handler: (req: import('http').IncomingMessage, res: import('http').ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/ort-wasm/')) return next();
        serveAsset(req.url, res, next);
      });
    },
    closeBundle() {
      const target = path.resolve(__dirname, 'dist/ort-wasm');
      fs.mkdirSync(target, { recursive: true });
      for (const filename of fs.readdirSync(onnxDir)) {
        if (onnxRuntimeAssetPattern.test(filename)) fs.copyFileSync(path.join(onnxDir, filename), path.join(target, filename));
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), envWriterPlugin(), onnxRuntimeAssetsPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Use base path from environment variable for GitHub Pages, or default to root
  // GitHub Actions will set BASE_PATH environment variable
  base: process.env.BASE_PATH || (process.env.NODE_ENV === 'production' ? '/yolov12-onnxruntime-web/' : '/'),
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
    strictPort: true,
    // En dev, on NE pose PAS COEP (require-corp) : cela bloquerait tous les flux
    // HLS cross-origin (ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep)
    // puisque les serveurs de test n'envoient pas d'en-tête CORP/Cross-Origin-Resource-Policy.
    // ONNX Runtime Web fonctionne en dev sans SharedArrayBuffer (fallback wasm classique).
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    fs: {
      allow: ['..'],
    },
  },
  preview: {
    // En preview (build de prod), on active COEP pour débloquer SharedArrayBuffer /
    // les threads ONNX. Les flux HLS cross-origin restent bloqués → ils nécessitent
    // un proxy same-origin ou des flux CORS-enabled en production.
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
});
