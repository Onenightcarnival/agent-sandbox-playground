<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import type { LLMConfig } from '@/types'

const emit = defineEmits<{
  update: [config: LLMConfig]
}>()

const baseUrl = ref('')
const apiKey = ref('')
const modelId = ref('')

const STORAGE_KEY = 'agent-sandbox-config'

onMounted(() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const config = JSON.parse(saved)
      baseUrl.value = config.baseUrl || ''
      apiKey.value = config.apiKey || ''
      modelId.value = config.modelId || ''
    }
  } catch {}
  emitConfig()
})

function emitConfig() {
  const config: LLMConfig = {
    baseUrl: baseUrl.value,
    apiKey: apiKey.value,
    modelId: modelId.value
  }
  emit('update', config)
}

watch([baseUrl, apiKey, modelId], () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    baseUrl: baseUrl.value,
    apiKey: apiKey.value,
    modelId: modelId.value
  }))
  emitConfig()
})
</script>

<template>
  <div class="config-panel">
    <div class="config-field">
      <label>Base URL</label>
      <input v-model="baseUrl" type="text" placeholder="https://api.openai.com/v1" />
    </div>
    <div class="config-field">
      <label>API Key</label>
      <input v-model="apiKey" type="password" placeholder="sk-..." />
    </div>
    <div class="config-field">
      <label>Model</label>
      <input v-model="modelId" type="text" placeholder="gpt-4o" />
    </div>
  </div>
</template>

<style scoped>
.config-panel {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  flex-wrap: wrap;
}

.config-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 180px;
}

.config-field label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.config-field input {
  padding: 6px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-family: var(--vp-font-family-mono);
}

.config-field input:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}
</style>
