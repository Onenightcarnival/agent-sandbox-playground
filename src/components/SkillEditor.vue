<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import CodeEditor from './CodeEditor.vue'
import type { Skill } from '@/types'

const props = defineProps<{
  skills: Skill[]
  selectedSkillId: string
  selectedFileName: string
}>()

const emit = defineEmits<{
  'update:selectedSkillId': [id: string]
  'update:selectedFileName': [name: string]
  'update:fileContent': [payload: { skillId: string; fileName: string; content: string }]
  'addFile': [skillId: string]
  'removeFile': [payload: { skillId: string; fileName: string }]
}>()

const currentSkill = computed(() =>
  props.skills.find(s => s.id === props.selectedSkillId)
)

const allFiles = computed(() => {
  if (!currentSkill.value) return []
  const files: { name: string; language: 'python' | 'markdown' }[] = [
    { name: 'SKILL.md', language: 'markdown' }
  ]
  for (const f of currentSkill.value.files) {
    files.push({ name: f.name, language: 'python' })
  }
  if (currentSkill.value.requirements) {
    files.push({ name: 'requirements.txt', language: 'markdown' })
  }
  return files
})

const currentFileContent = computed(() => {
  if (!currentSkill.value) return ''
  if (props.selectedFileName === 'SKILL.md') return currentSkill.value.skillMd
  if (props.selectedFileName === 'requirements.txt') return currentSkill.value.requirements
  const file = currentSkill.value.files.find(f => f.name === props.selectedFileName)
  return file?.content || ''
})

const currentLanguage = computed(() => {
  if (props.selectedFileName === 'SKILL.md') return 'markdown' as const
  if (props.selectedFileName === 'requirements.txt') return 'markdown' as const
  return 'python' as const
})

function onContentChange(content: string) {
  if (!currentSkill.value) return
  emit('update:fileContent', {
    skillId: currentSkill.value.id,
    fileName: props.selectedFileName,
    content
  })
}

function selectSkill(id: string) {
  emit('update:selectedSkillId', id)
  emit('update:selectedFileName', 'SKILL.md')
}

function handleAddFile() {
  if (!currentSkill.value) return
  emit('addFile', currentSkill.value.id)
}

function handleRemoveFile(fileName: string) {
  if (!currentSkill.value) return
  if (fileName === 'SKILL.md' || fileName === 'requirements.txt') return
  emit('removeFile', { skillId: currentSkill.value.id, fileName })
}

// Auto-select first file when skill changes
watch(() => props.selectedSkillId, () => {
  if (currentSkill.value && !allFiles.value.find(f => f.name === props.selectedFileName)) {
    emit('update:selectedFileName', 'SKILL.md')
  }
})
</script>

<template>
  <div class="skill-editor">
    <div v-if="skills.length === 0" class="empty-state">
      Upload a skill .zip to start editing
    </div>
    <template v-else>
      <!-- Skill selector -->
      <div class="skill-selector">
        <select
          :value="selectedSkillId"
          @change="selectSkill(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="skill in skills" :key="skill.id" :value="skill.id">
            {{ skill.name }}
          </option>
        </select>
      </div>

      <!-- File tabs -->
      <div v-if="currentSkill" class="file-tabs">
        <button
          v-for="file in allFiles"
          :key="file.name"
          class="file-tab"
          :class="{ active: selectedFileName === file.name }"
          @click="$emit('update:selectedFileName', file.name)"
        >
          <span class="file-name">{{ file.name }}</span>
          <span
            v-if="file.name !== 'SKILL.md' && file.name !== 'requirements.txt'"
            class="file-close"
            @click.stop="handleRemoveFile(file.name)"
          >&times;</span>
        </button>
        <button class="add-file-btn" @click="handleAddFile" title="Add Python file">+</button>
      </div>

      <!-- Editor -->
      <div v-if="currentSkill" class="editor-wrapper">
        <CodeEditor
          :key="`${selectedSkillId}-${selectedFileName}`"
          :model-value="currentFileContent"
          :language="currentLanguage"
          @update:model-value="onContentChange"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.skill-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--vp-c-text-3);
  font-size: 14px;
}

.skill-selector {
  padding: 6px 8px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.skill-selector select {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 600;
}

.file-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  overflow-x: auto;
  flex-shrink: 0;
}

.file-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
}

.file-tab.active {
  color: var(--vp-c-brand-1);
  border-bottom-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
}

.file-tab:hover:not(.active) {
  background: var(--vp-c-bg-elv);
}

.file-close {
  font-size: 14px;
  line-height: 1;
  opacity: 0.5;
  margin-left: 2px;
}

.file-close:hover {
  opacity: 1;
  color: var(--vp-c-danger-1);
}

.add-file-btn {
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-3);
  font-size: 16px;
  cursor: pointer;
}

.add-file-btn:hover {
  color: var(--vp-c-brand-1);
}

.editor-wrapper {
  flex: 1;
  min-height: 0;
}
</style>
