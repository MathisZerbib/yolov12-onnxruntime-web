import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { envWriterPlugin } from './scripts/env-writer-plugin.mjs';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), envWriterPlugin()],
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
