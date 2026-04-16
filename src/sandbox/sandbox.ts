import type { SandboxResult, ConsoleEntry } from '@/types'

type LogCallback = (entry: ConsoleEntry) => void

export class PyodideSandbox {
  private worker: Worker | null = null
  private pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>()
  private requestId = 0
  private onLog: LogCallback | null = null
  private _ready = false

  get ready() {
    return this._ready
  }

  setLogCallback(cb: LogCallback) {
    this.onLog = cb
  }

  async init() {
    if (this.worker) return

    this.worker = new Worker(
      new URL('./pyodide-worker.ts', import.meta.url),
      { type: 'classic' }
    )

    this.worker.onmessage = (event: MessageEvent) => {
      const { id, type, data } = event.data

      if (type === 'log') {
        this.onLog?.({
          type: data?.level === 'error' ? 'error' : 'info',
          message: event.data.message,
          timestamp: Date.now()
        })
        return
      }

      if (id && this.pendingRequests.has(id)) {
        const { resolve } = this.pendingRequests.get(id)!
        this.pendingRequests.delete(id)
        resolve(data)
      }
    }

    this.worker.onerror = (err) => {
      this.onLog?.({
        type: 'error',
        message: `Worker error: ${err.message}`,
        timestamp: Date.now()
      })
    }

    await this.sendMessage('init', {})
    this._ready = true
  }

  async installPackages(packages: string[]) {
    return this.sendMessage('install', { packages })
  }

  async execute(codeFiles: { name: string; content: string }[], callExpression: string): Promise<SandboxResult> {
    const result = await this.sendMessage('execute', { codeFiles, callExpression })
    return {
      success: result.success,
      output: result.output || '',
      error: result.error,
      logs: result.logs || []
    }
  }

  private sendMessage(action: string, payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'))
        return
      }
      const id = String(++this.requestId)
      this.pendingRequests.set(id, { resolve, reject })
      this.worker.postMessage({ id, action, payload })
    })
  }

  terminate() {
    this.worker?.terminate()
    this.worker = null
    this._ready = false
    this.pendingRequests.clear()
  }
}
