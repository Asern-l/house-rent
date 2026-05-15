import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    strictPort: true,
    host: '0.0.0.0',
    open: true,
    proxy: {
      '/api-auth': {
        target: 'http://127.0.0.1:3005',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-auth/, '/api'),
      },
      '/api-local': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-local/, '/api'),
      },
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
})

