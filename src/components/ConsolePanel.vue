<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { ConsoleEntry } from '@/types'

const props = defineProps<{
  entries: ConsoleEntry[]
}>()

const emit = defineEmits<{
  clear: []
}>()

const containerRef = ref<HTMLDivElement>()

watch(() => props.entries.length, async () => {
  await nextTick()
  if (containerRef.value) {
    containerRef.value.scrollTop = containerRef.value.scrollHeight
  }
})

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
}
</script>

<template>
  <div class="console-panel">
    <div class="console-header">
      <span>Console</span>
      <button class="clear-btn" @click="$emit('clear')">Clear</button>
    </div>
    <div ref="containerRef" class="console-entries">
      <div v-if="entries.length === 0" class="empty">No output yet</div>
      <div
        v-for="(entry, i) in entries"
        :key="i"
        class="entry"
        :class="entry.type"
      >
        <span class="time">{{ formatTime(entry.timestamp) }}</span>
        <span class="tag">{{ entry.type }}</span>
        <span class="msg">{{ entry.message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.console-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.console-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.clear-btn {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
}

.console-entries {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.6;
}

.empty {
  color: var(--vp-c-text-3);
  text-align: center;
  padding: 20px;
}

.entry {
  display: flex;
  gap: 8px;
  padding: 2px 0;
}

.time {
  color: var(--vp-c-text-3);
  flex-shrink: 0;
}

.tag {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.entry.info .tag { background: var(--vp-c-default-soft); color: var(--vp-c-text-2); }
.entry.error .tag { background: var(--vp-c-danger-soft); color: var(--vp-c-danger-1); }
.entry.output .tag { background: var(--vp-c-brand-soft); color: var(--vp-c-brand-1); }
.entry.tool .tag { background: var(--vp-c-warning-soft); color: var(--vp-c-warning-1); }

.msg {
  white-space: pre-wrap;
  word-break: break-all;
}

.entry.error .msg { color: var(--vp-c-danger-1); }
</style>
