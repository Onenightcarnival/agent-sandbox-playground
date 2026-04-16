<script setup lang="ts">
import { ref, onMounted, watch, shallowRef } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { lineNumbers, highlightActiveLineGutter, highlightActiveLine } from '@codemirror/view'
import { closeBrackets } from '@codemirror/autocomplete'

const props = defineProps<{
  modelValue: string
  language: 'python' | 'markdown'
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const editorRef = ref<HTMLDivElement>()
const view = shallowRef<EditorView>()

onMounted(() => {
  if (!editorRef.value) return

  const langExtension = props.language === 'python' ? python() : markdown()

  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      bracketMatching(),
      closeBrackets(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      langExtension,
      oneDark,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString())
        }
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-content': { fontFamily: 'var(--vp-font-family-mono)' }
      }),
      ...(props.placeholder ? [cmPlaceholder(props.placeholder)] : [])
    ]
  })

  view.value = new EditorView({
    state,
    parent: editorRef.value
  })
})

watch(() => props.modelValue, (newVal) => {
  if (view.value && view.value.state.doc.toString() !== newVal) {
    view.value.dispatch({
      changes: {
        from: 0,
        to: view.value.state.doc.length,
        insert: newVal
      }
    })
  }
})
</script>

<template>
  <div ref="editorRef" class="code-editor" />
</template>

<style scoped>
.code-editor {
  height: 100%;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  overflow: hidden;
}

.code-editor :deep(.cm-editor) {
  height: 100%;
}
</style>
