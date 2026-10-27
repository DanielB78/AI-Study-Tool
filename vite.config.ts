import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
  '/health': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
} as const

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow Cloudflare quick tunnels / other preview hosts.
    allowedHosts: true,
    // Same-origin proxy so a public tunnel only needs the Vite port.
    proxy: { ...apiProxy },
  },
  // Production `vite preview` (used behind Cloudflare tunnel) needs the same proxy.
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    proxy: { ...apiProxy },
  },
})
