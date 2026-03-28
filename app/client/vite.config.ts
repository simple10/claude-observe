import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const serverPort = process.env.SERVER_PORT || '4981'
const clientPort = Number(process.env.CLIENT_PORT || '5174')

const customBanner = {
  name: 'custom-banner',
  configureServer(server) {
    const { printUrls } = server
    server.printUrls = () => {
      console.log(`\n  🚀 Dashboard: http://localhost:${clientPort}\n`)
      printUrls()
    }
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), customBanner],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: clientPort,
    proxy: {
      '/api': {
        target: `http://localhost:${serverPort}`,
        ws: true,
      },
    },
  },
})
