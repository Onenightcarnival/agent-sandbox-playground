import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Playground from '@/components/Playground.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Playground', Playground)
  }
} satisfies Theme
