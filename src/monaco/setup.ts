import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

let configured = false

// Only the base editor worker is wired — Python/Markdown are handled by
// Monaco's built-in Monarch tokenizers, and TS/JSON/CSS/HTML aren't used
// anywhere in this playground, so pulling those workers would just bloat the
// bundle.
export function ensureMonacoConfigured() {
  if (configured) return
  configured = true

  ;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
    getWorker() {
      return new EditorWorker()
    },
  }

  monaco.editor.defineTheme('cosmic-night', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0a0a0f',
      'editor.foreground': '#ebebf5',
      'editorLineNumber.foreground': '#3a3a4a',
      'editorLineNumber.activeForeground': '#8b9cf7',
      'editor.selectionBackground': '#8b9cf740',
      'editor.inactiveSelectionBackground': '#8b9cf720',
      'editor.lineHighlightBackground': '#14141e',
      'editor.lineHighlightBorder': '#14141e',
      'editorCursor.foreground': '#8b9cf7',
      'editorIndentGuide.background1': '#1a1a24',
      'editorIndentGuide.activeBackground1': '#2a2a38',
      'editorWidget.background': '#0d0d14',
      'editorWidget.border': '#1a1a24',
      'editorSuggestWidget.background': '#0d0d14',
      'editorSuggestWidget.border': '#1a1a24',
      'editorHoverWidget.background': '#0d0d14',
      'editorHoverWidget.border': '#1a1a24',
      'dropdown.background': '#12121a',
      'dropdown.border': '#1a1a24',
      'scrollbarSlider.background': '#8b9cf720',
      'scrollbarSlider.hoverBackground': '#8b9cf740',
      'scrollbarSlider.activeBackground': '#8b9cf760',
    },
  })

  monaco.editor.defineTheme('cosmic-dusk', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#faf6f0',
      'editor.foreground': '#3d3428',
      'editorLineNumber.foreground': '#a89e8e',
      'editorLineNumber.activeForeground': '#c8860a',
      'editor.selectionBackground': '#c8860a38',
      'editor.inactiveSelectionBackground': '#c8860a1c',
      'editor.lineHighlightBackground': '#f0e9de',
      'editor.lineHighlightBorder': '#f0e9de',
      'editorCursor.foreground': '#c8860a',
      'editorIndentGuide.background1': '#e8dfd0',
      'editorIndentGuide.activeBackground1': '#d0c5b0',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#e8dfd0',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#e8dfd0',
      'editorHoverWidget.background': '#ffffff',
      'editorHoverWidget.border': '#e8dfd0',
      'dropdown.background': '#ffffff',
      'dropdown.border': '#e8dfd0',
      'scrollbarSlider.background': '#c8860a20',
      'scrollbarSlider.hoverBackground': '#c8860a40',
      'scrollbarSlider.activeBackground': '#c8860a60',
    },
  })
}

export function themeIdFor(cosmic: 'night' | 'dusk'): string {
  return cosmic === 'dusk' ? 'cosmic-dusk' : 'cosmic-night'
}

export { monaco }
