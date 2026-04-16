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

function handleSend() {
  const text = input.value.trim()
  if (!text || props.loading) return
  emit('send', text)
  input.value = ''
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
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
    <div class="input-area">
      <textarea
        v-model="input"
        :disabled="loading"
        placeholder="Send a message..."
        rows="2"
        @keydown="handleKeydown"
      />
      <button v-if="loading" class="stop-btn" @click="$emit('stop')">Stop</button>
      <button v-else class="send-btn" :disabled="!input.trim()" @click="handleSend">Send</button>
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

.input-area {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--vp-c-divider);
}

.input-area textarea {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 14px;
  resize: none;
  font-family: inherit;
}

.input-area textarea:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}

.send-btn, .stop-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  font-size: 13px;
}

.send-btn {
  background: var(--vp-c-brand-1);
  color: white;
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stop-btn {
  background: var(--vp-c-danger-1);
  color: white;
}
</style>
