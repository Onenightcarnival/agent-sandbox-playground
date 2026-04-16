<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import ConfigPanel from './ConfigPanel.vue'
import SkillManager from './SkillManager.vue'
import SkillEditor from './SkillEditor.vue'
import ChatPanel from './ChatPanel.vue'
import ConsolePanel from './ConsolePanel.vue'
import { createClient } from '@/agent/openai-client'
import { runAgentLoop } from '@/agent/loop'
import { PyodideSandbox } from '@/sandbox/sandbox'
import type { LLMConfig, ChatMessage, ConsoleEntry, Skill } from '@/types'

const config = ref<LLMConfig>({ baseUrl: '', apiKey: '', modelId: '' })
const skills = ref<Skill[]>([])
const selectedSkillId = ref('')
const selectedFileName = ref('SKILL.md')

const messages = ref<ChatMessage[]>([])
const consoleEntries = ref<ConsoleEntry[]>([])
const loading = ref(false)
const streamingContent = ref('')
const sandboxReady = ref(false)
const abortController = ref<AbortController | null>(null)

const sandbox = new PyodideSandbox()

sandbox.setLogCallback((entry) => {
  consoleEntries.value.push(entry)
})

onMounted(async () => {
  consoleEntries.value.push({
    type: 'info',
    message: 'Initializing Pyodide sandbox...',
    timestamp: Date.now()
  })

  try {
    await sandbox.init()
    sandboxReady.value = true
    consoleEntries.value.push({
      type: 'info',
      message: 'Pyodide sandbox ready',
      timestamp: Date.now()
    })
  } catch (e: any) {
    consoleEntries.value.push({
      type: 'error',
      message: `Failed to init sandbox: ${e.message}`,
      timestamp: Date.now()
    })
  }
})

onUnmounted(() => {
  sandbox.terminate()
})

function onConfigUpdate(c: LLMConfig) {
  config.value = c
}

function addSkill(skill: Skill) {
  skills.value.push(skill)
  selectedSkillId.value = skill.id
  selectedFileName.value = 'SKILL.md'
  consoleEntries.value.push({
    type: 'info',
    message: `Loaded skill: ${skill.name} (${skill.files.length} Python files)`,
    timestamp: Date.now()
  })

  // Install requirements if present
  if (skill.requirements) {
    const packages = skill.requirements
      .split('\n')
      .map(l => l.trim().replace(/[>=<].*/,''))
      .filter(l => l && !l.startsWith('#'))

    if (packages.length > 0) {
      consoleEntries.value.push({
        type: 'info',
        message: `Installing packages: ${packages.join(', ')}`,
        timestamp: Date.now()
      })
      sandbox.installPackages(packages)
    }
  }
}

function removeSkill(id: string) {
  const idx = skills.value.findIndex(s => s.id === id)
  if (idx === -1) return
  skills.value.splice(idx, 1)
  if (selectedSkillId.value === id) {
    selectedSkillId.value = skills.value[0]?.id || ''
    selectedFileName.value = 'SKILL.md'
  }
}

function selectSkill(id: string) {
  selectedSkillId.value = id
  selectedFileName.value = 'SKILL.md'
}

function updateFileContent(payload: { skillId: string; fileName: string; content: string }) {
  const skill = skills.value.find(s => s.id === payload.skillId)
  if (!skill) return

  if (payload.fileName === 'SKILL.md') {
    skill.skillMd = payload.content
  } else if (payload.fileName === 'requirements.txt') {
    skill.requirements = payload.content
  } else {
    const file = skill.files.find(f => f.name === payload.fileName)
    if (file) file.content = payload.content
  }
}

function addFile(skillId: string) {
  const skill = skills.value.find(s => s.id === skillId)
  if (!skill) return

  let name = 'new_module.py'
  let counter = 1
  while (skill.files.some(f => f.name === name)) {
    name = `new_module_${counter++}.py`
  }

  skill.files.push({ name, content: '' })
  selectedFileName.value = name
}

function removeFile(payload: { skillId: string; fileName: string }) {
  const skill = skills.value.find(s => s.id === payload.skillId)
  if (!skill) return

  const idx = skill.files.findIndex(f => f.name === payload.fileName)
  if (idx !== -1) {
    skill.files.splice(idx, 1)
    if (selectedFileName.value === payload.fileName) {
      selectedFileName.value = 'SKILL.md'
    }
  }
}

async function handleSend(text: string) {
  if (!config.value.baseUrl || !config.value.apiKey || !config.value.modelId) {
    consoleEntries.value.push({
      type: 'error',
      message: 'Please fill in Base URL, API Key, and Model',
      timestamp: Date.now()
    })
    return
  }

  if (!sandboxReady.value) {
    consoleEntries.value.push({
      type: 'error',
      message: 'Sandbox is not ready yet',
      timestamp: Date.now()
    })
    return
  }

  if (skills.value.length === 0) {
    consoleEntries.value.push({
      type: 'error',
      message: 'No skills loaded. Upload a .zip skill first.',
      timestamp: Date.now()
    })
    return
  }

  const userMsg: ChatMessage = {
    id: `msg_${Date.now()}`,
    role: 'user',
    content: text,
    timestamp: Date.now()
  }
  messages.value.push(userMsg)

  loading.value = true
  streamingContent.value = ''
  abortController.value = new AbortController()

  try {
    const client = createClient(config.value)

    await runAgentLoop({
      client,
      modelId: config.value.modelId,
      skills: skills.value,
      messages: messages.value,
      sandbox,
      signal: abortController.value.signal,
      onAssistantChunk(chunk) {
        streamingContent.value += chunk
      },
      onToolCall(name, args) {
        consoleEntries.value.push({
          type: 'tool',
          message: `Tool call: ${name} -> ${args}`,
          timestamp: Date.now()
        })
      },
      onToolResult(name, result) {
        consoleEntries.value.push({
          type: 'output',
          message: `Tool result: ${result}`,
          timestamp: Date.now()
        })
      },
      onConsole(entry) {
        consoleEntries.value.push(entry)
      },
      onDone(msg) {
        messages.value.push(msg)
        streamingContent.value = ''
      }
    })
  } catch (e: any) {
    if (e.name !== 'AbortError') {
      consoleEntries.value.push({
        type: 'error',
        message: `Error: ${e.message}`,
        timestamp: Date.now()
      })
    }
  } finally {
    loading.value = false
    streamingContent.value = ''
    abortController.value = null
  }
}

function handleStop() {
  abortController.value?.abort()
}

function clearConsole() {
  consoleEntries.value = []
}

function clearChat() {
  messages.value = []
  streamingContent.value = ''
}
</script>

<template>
  <div class="playground">
    <ConfigPanel @update="onConfigUpdate" />

    <div class="main-layout">
      <!-- Left: Skill Manager + Editor -->
      <div class="left-section">
        <SkillManager
          :skills="skills"
          @add="addSkill"
          @remove="removeSkill"
          @select="selectSkill"
        />
        <div class="editor-section">
          <SkillEditor
            :skills="skills"
            :selected-skill-id="selectedSkillId"
            :selected-file-name="selectedFileName"
            @update:selected-skill-id="selectedSkillId = $event"
            @update:selected-file-name="selectedFileName = $event"
            @update:file-content="updateFileContent"
            @add-file="addFile"
            @remove-file="removeFile"
          />
        </div>
      </div>

      <!-- Right: Chat + Console -->
      <div class="right-section">
        <div class="chat-section">
          <div class="section-header">
            <span>Chat</span>
            <div class="header-actions">
              <span v-if="skills.length > 0" class="skill-count">{{ skills.length }} skill{{ skills.length !== 1 ? 's' : '' }} loaded</span>
              <button class="clear-btn" @click="clearChat">Clear</button>
            </div>
          </div>
          <ChatPanel
            :messages="messages"
            :loading="loading"
            :streaming-content="streamingContent"
            @send="handleSend"
            @stop="handleStop"
          />
        </div>
        <div class="console-section">
          <ConsolePanel
            :entries="consoleEntries"
            @clear="clearConsole"
          />
        </div>
      </div>
    </div>

    <div v-if="!sandboxReady" class="sandbox-status">
      Loading Pyodide sandbox...
    </div>
  </div>
</template>

<style scoped>
.playground {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 0;
  height: 85vh;
}

.main-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.left-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 0;
}

.editor-section {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
}

.right-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.chat-section {
  flex: 2;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  min-height: 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-count {
  font-size: 11px;
  color: var(--vp-c-brand-1);
  font-weight: 500;
}

.section-header .clear-btn {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
}

.console-section {
  flex: 1;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  min-height: 0;
}

.sandbox-status {
  text-align: center;
  padding: 8px;
  background: var(--vp-c-warning-soft);
  border-radius: 6px;
  font-size: 13px;
  color: var(--vp-c-warning-1);
}

@media (max-width: 768px) {
  .main-layout {
    grid-template-columns: 1fr;
  }
}
</style>
