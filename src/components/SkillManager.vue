<script setup lang="ts">
import { ref } from 'vue'
import JSZip from 'jszip'
import type { Skill, SkillFile } from '@/types'

const props = defineProps<{
  skills: Skill[]
}>()

const emit = defineEmits<{
  add: [skill: Skill]
  remove: [id: string]
  select: [id: string]
}>()

const dragging = ref(false)
const fileInputRef = ref<HTMLInputElement>()

function parseFrontmatter(md: string): { name: string; description: string } {
  const match = md.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return { name: 'Unnamed Skill', description: '' }

  const yaml = match[1]
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim() || 'Unnamed Skill'
  const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim() || ''
  return { name, description }
}

async function parseZip(file: File): Promise<Skill | null> {
  try {
    const zip = await JSZip.loadAsync(file)
    const entries = Object.keys(zip.files)

    // Find the common prefix (zip may have a top-level folder)
    let prefix = ''
    const dirs = entries.filter(e => e.endsWith('/'))
    if (dirs.length > 0) {
      const topDirs = dirs.filter(d => d.split('/').filter(Boolean).length === 1)
      if (topDirs.length === 1) {
        prefix = topDirs[0]
      }
    }

    let skillMd = ''
    const pyFiles: SkillFile[] = []
    let requirements = ''

    for (const [path, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue

      const relativePath = prefix ? path.replace(prefix, '') : path
      if (!relativePath) continue

      const content = await zipEntry.async('string')
      const fileName = relativePath.split('/').pop() || relativePath

      if (fileName.toLowerCase() === 'skill.md') {
        skillMd = content
      } else if (fileName === 'requirements.txt') {
        requirements = content
      } else if (fileName.endsWith('.py')) {
        pyFiles.push({ name: relativePath, content })
      }
    }

    if (!skillMd) {
      alert(`No SKILL.md found in ${file.name}`)
      return null
    }

    const { name, description } = parseFrontmatter(skillMd)

    return {
      id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      description,
      skillMd,
      files: pyFiles,
      requirements
    }
  } catch (e: any) {
    alert(`Failed to parse ${file.name}: ${e.message}`)
    return null
  }
}

async function handleFiles(files: FileList | File[]) {
  for (const file of files) {
    if (!file.name.endsWith('.zip')) {
      alert(`${file.name} is not a zip file`)
      continue
    }
    const skill = await parseZip(file)
    if (skill) {
      emit('add', skill)
    }
  }
}

function onDrop(e: DragEvent) {
  dragging.value = false
  if (e.dataTransfer?.files) {
    handleFiles(e.dataTransfer.files)
  }
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) {
    handleFiles(input.files)
  }
  input.value = ''
}

function openFilePicker() {
  fileInputRef.value?.click()
}
</script>

<template>
  <div class="skill-manager">
    <div
      class="upload-zone"
      :class="{ dragging }"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
      @click="openFilePicker"
    >
      <input
        ref="fileInputRef"
        type="file"
        accept=".zip"
        multiple
        hidden
        @change="onFileInput"
      />
      <div class="upload-text">
        <span class="upload-icon">+</span>
        <span>Drop skill .zip files here or click to upload</span>
      </div>
    </div>

    <div v-if="skills.length > 0" class="skill-list">
      <div
        v-for="skill in skills"
        :key="skill.id"
        class="skill-item"
        @click="$emit('select', skill.id)"
      >
        <div class="skill-info">
          <div class="skill-name">{{ skill.name }}</div>
          <div class="skill-desc">{{ skill.description || 'No description' }}</div>
          <div class="skill-meta">
            {{ skill.files.length }} file{{ skill.files.length !== 1 ? 's' : '' }}
            <span v-if="skill.requirements"> &middot; has requirements.txt</span>
          </div>
        </div>
        <button class="remove-btn" @click.stop="$emit('remove', skill.id)" title="Remove skill">&times;</button>
      </div>
    </div>
    <div v-else class="empty-state">
      No skills loaded. Upload a .zip file to get started.
    </div>
  </div>
</template>

<style scoped>
.skill-manager {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upload-zone {
  border: 2px dashed var(--vp-c-divider);
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}

.upload-zone:hover,
.upload-zone.dragging {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.upload-text {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.upload-icon {
  font-size: 20px;
  font-weight: bold;
  color: var(--vp-c-brand-1);
}

.skill-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.skill-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.skill-item:hover {
  background: var(--vp-c-bg-soft);
}

.skill-info {
  min-width: 0;
}

.skill-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.skill-desc {
  font-size: 12px;
  color: var(--vp-c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}

.skill-meta {
  font-size: 11px;
  color: var(--vp-c-text-3);
  margin-top: 2px;
}

.remove-btn {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-3);
  font-size: 18px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.remove-btn:hover {
  background: var(--vp-c-danger-soft);
  color: var(--vp-c-danger-1);
}

.empty-state {
  text-align: center;
  padding: 12px;
  color: var(--vp-c-text-3);
  font-size: 13px;
}
</style>
