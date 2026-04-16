import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Layout from './Layout.vue'
import Playground from '@/components/Playground.vue'
import './styles/cosmic.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('Playground', Playground)
  }
} satisfies Theme
