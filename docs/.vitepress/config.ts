import { defineConfig } from 'vitepress'
import path from 'node:path'

export default defineConfig({
  title: 'Agent Sandbox',
  description: 'Browser-based playground for debugging custom OpenAI-format skills',
  base: '/agent-sandbox-playground/',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Playground', link: '/playground' }
    ]
  },
  vite: {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '../../src')
      }
    },
    worker: {
      format: 'es'
    },
    server: {
      proxy: {
        '/api': {
          target: process.env.API_TARGET || 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api/, '')
        }
      }
    }
  }
})
