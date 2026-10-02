import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const serverPort = Number(process.env.SERVER_PORT ?? 8787)

export default defineConfig({
  root: 'src/web',
  publicDir: 'public',
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5199),
    host: true,
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
      '/api': `http://localhost:${serverPort}`,
    },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
})
