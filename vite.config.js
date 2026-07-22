import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// The Boids agent API is proxied under /api/agent so the API key stays
// server-side (Vite in dev/preview, nginx in production — see deploy.sh).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const agentProxy = {
    '/api/agent': {
      target: 'https://staging-api.boids.so',
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/api\/agent/, '/v1'),
      headers: {
        Authorization: `Bearer ${env.BOIDS_API_KEY || ''}`,
      },
      // Streaming replies can run long; don't let the proxy cut them off.
      timeout: 300000,
      proxyTimeout: 300000,
    },
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: { proxy: agentProxy },
    preview: { proxy: agentProxy },
    build: {
      outDir: 'dist',
      rollupOptions: {
        // Entry stays index-b.html so the existing nginx config keeps working;
        // the agent chat page builds to /agent/ as a second entry.
        input: ['index-b.html', 'agent/index.html'],
      },
    },
  }
})
