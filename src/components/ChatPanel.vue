<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import type { ChatMessage } from '@/types'

const props = defineProps<{
  messages: ChatMessage[]
  loading: boolean
  streamingContent: string
}>()

const emit = defineEmits<{
  send: [message: string]
  stop: []
}>()

const input = ref('')
const messagesRef = ref<HTMLDivElement>()
const textareaRef = ref<HTMLTextAreaElement>()

function handleSend() {
  const text = input.value.trim()
  if (!text || props.loading) return
  emit('send', text)
  input.value = ''
  resetTextareaHeight()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  const maxHeight = 6 * 22 // 6 lines * ~22px line height
  el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px'
}

function resetTextareaHeight() {
  const el = textareaRef.value
  if (!el) return
  nextTick(() => {
    el.style.height = 'auto'
  })
}

watch(() => props.messages.length, async () => {
  await nextTick()
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  }
})

watch(() => props.streamingContent, async () => {
  await nextTick()
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  }
})
</script>

<template>
  <div class="chat-panel">
    <div ref="messagesRef" class="messages">
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="message"
        :class="msg.role"
      >
        <div class="message-role">{{ msg.role }}</div>
        <div class="message-content">
          <template v-if="msg.role === 'tool'">
            <code class="tool-result">{{ msg.content }}</code>
          </template>
          <template v-else>
            {{ msg.content }}
          </template>
        </div>
        <div v-if="msg.toolCalls?.length" class="tool-calls">
          <div v-for="tc in msg.toolCalls" :key="tc.id" class="tool-call">
            <code>{{ tc.function.name }}({{ tc.function.arguments }})</code>
          </div>
        </div>
      </div>
      <div v-if="streamingContent" class="message assistant streaming">
        <div class="message-role">assistant</div>
        <div class="message-content">{{ streamingContent }}</div>
      </div>
    </div>
    <div class="input-container">
      <div class="input-box" :class="{ focused: false }">
        <textarea
          ref="textareaRef"
          v-model="input"
          :disabled="loading"
          placeholder="Send a message..."
          rows="1"
          @keydown="handleKeydown"
          @input="autoResize"
        />
        <button v-if="loading" class="stop-btn" @click="$emit('stop')">Stop</button>
        <button v-else class="send-icon-btn" :disabled="!input.trim()" @click="handleSend">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message {
  padding: 8px 12px;
  border-radius: 8px;
  max-width: 100%;
}

.message.user {
  background: var(--vp-c-brand-soft);
}

.message.assistant {
  background: var(--vp-c-bg-soft);
}

.message.tool {
  background: var(--vp-c-warning-soft);
  font-size: 12px;
}

.message.streaming {
  opacity: 0.8;
}

.message-role {
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-3);
  margin-bottom: 4px;
  text-transform: uppercase;
}

.message-content {
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-result {
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
}

.tool-calls {
  margin-top: 6px;
}

.tool-call code {
  font-size: 12px;
  background: var(--vp-c-bg-alt);
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-block;
}

.input-container {
  padding: 12px 16px 16px;
}

.input-box {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  padding: 10px 12px 10px 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.input-box:focus-within {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.25);
}

.input-box textarea {
  flex: 1;
  padding: 2px 0;
  border: none;
  background: transparent;
  color: var(--vp-c-text-1);
  font-size: 14px;
  line-height: 22px;
  resize: none;
  font-family: inherit;
  max-height: 132px;
  overflow-y: auto;
}

.input-box textarea:focus {
  outline: none;
}

.send-icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: var(--vp-c-brand-1);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 0.15s;
}

.send-icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.send-icon-btn:not(:disabled):hover {
  opacity: 0.85;
}

.stop-btn {
  padding: 6px 14px;
  border: none;
  border-radius: 16px;
  font-weight: 600;
  cursor: pointer;
  font-size: 12px;
  background: var(--vp-c-danger-1);
  color: white;
  flex-shrink: 0;
}
</style>
