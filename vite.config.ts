import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

// In development the Lighter API is reached through the same /lighter-api
// prefix the production server proxies, so the client code is identical.
const upstream = process.env.LIGHTER_API_URL ?? 'https://mainnet.zklighter.elliot.ai'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/lighter-api': {
        target: upstream,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lighter-api/, ''),
      },
    },
  },
  build: {
    // The signer wasm lives in public/ and is copied verbatim; nothing else is large.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
