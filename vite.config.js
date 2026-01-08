import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      // Dev-only CORS bypass for Binance REST fallback in browser.
      // In production builds we still rely on WS/native services.
      '/binance-api': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/binance-api/, ''),
      },
      '/binance-fapi': {
        target: 'https://fapi.binance.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/binance-fapi/, ''),
      },
    },
  },
})
