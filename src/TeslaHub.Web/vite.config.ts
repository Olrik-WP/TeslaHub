import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || pkg.version),
  },
  build: {
    // ES2020 is required by maplibre-gl 5+ (uses BigInt literals).
    // Supported by Tesla in-car Chromium (>=80), Safari 14+, modern Chrome / Firefox / Edge.
    target: ['es2020', 'safari14'],
    rollupOptions: {
      output: {
        // Three.js + React Three Fiber are heavy (~600 KB gzip combined).
        // Split them into a separate async chunk so they only load when the
        // 3D vehicle view actually mounts (lazy-loaded), not on initial boot.
        // Vite 8 uses Rolldown which requires `manualChunks` to be a function.
        manualChunks: (id: string) => {
          if (
            id.includes('node_modules/three/') ||
            id.includes('node_modules/@react-three/')
          ) {
            return 'three-vendor';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
