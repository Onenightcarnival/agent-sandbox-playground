import { defineConfig, loadEnv } from 'vitepress'
import path from 'node:path'

const env = loadEnv('', path.resolve(__dirname, '../..'), '')
const apiTarget = env.API_TARGET || 'http://localhost:8000'

console.log(`[proxy] API_TARGET = ${apiTarget}`)

export default defineConfig({
  title: 'Agent Sandbox',
  description: 'Browser-based playground for debugging custom OpenAI-format skills',
  base: '/agent-sandbox-playground/',
  themeConfig: {
    nav: [
      { text: 'Playground', link: '/playground' }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Onenightcarnival/agent-sandbox-playground' }
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
          target: apiTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (p: string) => p.replace(/^\/api/, '')
        }
      }
    }
  }
})
