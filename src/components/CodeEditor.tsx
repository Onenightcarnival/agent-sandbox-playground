import { useEffect, useRef } from 'react'
import { ensureMonacoConfigured, themeIdFor, monaco } from '@/monaco/setup'
import { useCosmicTheme } from '@/hooks/useCosmicTheme'
import './CodeEditor.css'

export interface RevealLine {
  line: number
  column?: number
  /** Bump to re-trigger a reveal for the same line. */
  nonce: number
}

interface Props {
  value: string
  language: 'python' | 'markdown'
  /** Stable key per file — used to cache per-file models so undo history and
   *  scroll position are preserved across tab switches. */
  modelKey: string
  onChange: (value: string) => void
  revealLine?: RevealLine | null
}

export default function CodeEditor({ value, language, modelKey, onChange, revealLine }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelsRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map())
  const onChangeRef = useRef(onChange)
  const suppressChangeRef = useRef(false)
  const { theme } = useCosmicTheme()

  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  useEffect(() => {
    if (!containerRef.current) return
    ensureMonacoConfigured()

    const editor = monaco.editor.create(containerRef.current, {
      theme: themeIdFor(theme),
      automaticLayout: true,
      fontFamily: 'var(--vp-font-family-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 4,
      renderLineHighlight: 'line',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      padding: { top: 8, bottom: 8 },
      fixedOverflowWidgets: true,
    })

    const disp = editor.onDidChangeModelContent(() => {
      if (suppressChangeRef.current) return
      const model = editor.getModel()
      if (model) onChangeRef.current(model.getValue())
    })

    editorRef.current = editor

    return () => {
      disp.dispose()
      editor.dispose()
      for (const m of modelsRef.current.values()) m.dispose()
      modelsRef.current.clear()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Theme follows cosmic theme toggle.
  useEffect(() => {
    monaco.editor.setTheme(themeIdFor(theme))
  }, [theme])

  // Swap the model when the active file (or its language) changes.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    let model = modelsRef.current.get(modelKey)
    if (!model) {
      model = monaco.editor.createModel(value, language)
      modelsRef.current.set(modelKey, model)
    } else {
      if (model.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(model, language)
      }
      if (model.getValue() !== value) {
        suppressChangeRef.current = true
        model.setValue(value)
        suppressChangeRef.current = false
      }
    }
    editor.setModel(model)
  }, [modelKey, language]) // eslint-disable-line react-hooks/exhaustive-deps

  // External value → model sync (e.g. agent wrote to the file while open).
  useEffect(() => {
    const model = modelsRef.current.get(modelKey)
    if (!model) return
    if (model.getValue() !== value) {
      suppressChangeRef.current = true
      model.setValue(value)
      suppressChangeRef.current = false
    }
  }, [value, modelKey])

  // Reveal-line pulses from the palette (search result jump).
  useEffect(() => {
    if (!revealLine) return
    const editor = editorRef.current
    if (!editor) return
    const position = { lineNumber: revealLine.line, column: revealLine.column ?? 1 }
    editor.revealLineInCenter(revealLine.line)
    editor.setPosition(position)
    editor.focus()
  }, [revealLine?.nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className="code-editor" />
}
