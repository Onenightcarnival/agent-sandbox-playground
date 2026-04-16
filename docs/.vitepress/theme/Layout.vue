<script setup>
import DefaultTheme from 'vitepress/theme'
import CosmicToggle from '@/components/CosmicToggle.vue'
import SnowCanvas from '@/components/SnowCanvas.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #nav-bar-content-after>
      <CosmicToggle />
    </template>
    <template #layout-top>
      <SnowCanvas />
    </template>
  </Layout>
</template>
