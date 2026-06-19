import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,

    allowedHosts: [ 
      '.trycloudflare.com',
      'cats-aaron-beds-adapters.trycloudflare.com',
    ],
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
