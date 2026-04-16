<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { LLMConfig } from '@/types'

const emit = defineEmits<{
  update: [config: LLMConfig]
  'update:envVars': [vars: Record<string, string>]
}>()

const baseUrl = ref('')
const apiKey = ref('')
const modelId = ref('')
const envVars = ref<{ key: string; value: string }[]>([])

const collapsed = ref(true)

const STORAGE_KEY = 'agent-sandbox-config'
const ENV_STORAGE_KEY = 'agent-sandbox-env'

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
  try {
    const savedEnv = localStorage.getItem(ENV_STORAGE_KEY)
    if (savedEnv) {
      envVars.value = JSON.parse(savedEnv)
    }
  } catch {}
  emitConfig()
  emitEnvVars()
})

function emitConfig() {
  emit('update', {
    baseUrl: baseUrl.value,
    apiKey: apiKey.value,
    modelId: modelId.value
  })
}

const envVarsMap = computed(() => {
  const vars: Record<string, string> = {
    OPENAI_BASE_URL: baseUrl.value,
    OPENAI_API_KEY: apiKey.value,
    MODEL_ID: modelId.value
  }
  for (const { key, value } of envVars.value) {
    if (key.trim()) vars[key.trim()] = value
  }
  return vars
})

function emitEnvVars() {
  emit('update:envVars', envVarsMap.value)
}

const configSummary = computed(() => {
  const model = modelId.value || 'No model'
  const key = apiKey.value
    ? `sk-...${apiKey.value.slice(-3)}`
    : 'No key'
  let domain = 'No URL'
  try {
    domain = new URL(baseUrl.value).hostname
  } catch {}
  return `${model} · ${key} · ${domain}`
})

const hasConfig = computed(() => !!(baseUrl.value && apiKey.value && modelId.value))

function addEnvVar() {
  envVars.value.push({ key: '', value: '' })
}

function removeEnvVar(index: number) {
  envVars.value.splice(index, 1)
}

watch([baseUrl, apiKey, modelId], () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    baseUrl: baseUrl.value,
    apiKey: apiKey.value,
    modelId: modelId.value
  }))
  emitConfig()
  emitEnvVars()
})

watch(envVars, () => {
  localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify(envVars.value))
  emitEnvVars()
}, { deep: true })
</script>

<template>
  <div class="config-panel" :class="{ collapsed }">
    <!-- Collapsed summary bar -->
    <div v-if="collapsed" class="config-summary-bar" @click="collapsed = false">
      <div class="summary-left">
        <span class="status-dot" :class="{ active: hasConfig }"></span>
        <span class="summary-text">{{ configSummary }}</span>
      </div>
      <button class="edit-toggle" @click.stop="collapsed = false">Edit &#x25BE;</button>
    </div>

    <!-- Expanded form -->
    <template v-else>
      <div class="config-header">
        <span class="config-title">Configuration</span>
        <button class="collapse-btn" @click="collapsed = true">Collapse &#x25B4;</button>
      </div>
      <div class="config-row">
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

      <div class="env-section">
        <label class="env-label">Environment Variables</label>
        <div class="env-list">
          <div v-for="(env, i) in envVars" :key="i" class="env-row">
            <input v-model="env.key" type="text" placeholder="KEY" class="env-input env-key-input" />
            <input v-model="env.value" type="text" placeholder="value" class="env-input env-value-input" />
            <button class="env-remove" @click="removeEnvVar(i)" title="Remove">&times;</button>
          </div>
        </div>
        <button class="env-add" @click="addEnvVar">+ Add Variable</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.config-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
}

.config-panel.collapsed {
  padding: 0;
}

.config-panel:not(.collapsed) {
  padding: 12px;
}

/* Collapsed summary bar */
.config-summary-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s;
}

.config-summary-bar:hover {
  background: var(--vp-c-bg-alt);
}

.summary-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-text-3);
  flex-shrink: 0;
}

.status-dot.active {
  background: #4ade80;
}

.summary-text {
  font-size: 12px;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
}

.edit-toggle {
  font-size: 11px;
  color: var(--vp-c-brand-1);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
}

/* Expanded header */
.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.config-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.collapse-btn {
  font-size: 11px;
  color: var(--vp-c-brand-1);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
}

.config-row {
  display: flex;
  gap: 12px;
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

.env-section {
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 8px;
}

.env-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.env-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

.env-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.env-input {
  padding: 4px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
}

.env-input:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}

.env-key-input {
  width: 160px;
  flex-shrink: 0;
}

.env-value-input {
  flex: 1;
  min-width: 0;
}

.env-remove {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-3);
  font-size: 16px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.env-remove:hover {
  background: var(--vp-c-danger-soft);
  color: var(--vp-c-danger-1);
}

.env-add {
  align-self: flex-start;
  padding: 3px 10px;
  border: 1px dashed var(--vp-c-divider);
  border-radius: 4px;
  background: transparent;
  color: var(--vp-c-text-3);
  font-size: 11px;
  cursor: pointer;
  margin-top: 2px;
}

.env-add:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
</style>
