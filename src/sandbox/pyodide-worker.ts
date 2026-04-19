// This module runs in a Web Worker. Cast the global `self` to the worker scope
// so the DOM `self: Window` typing from the shared lib doesn't apply here.
const workerSelf = self as unknown as DedicatedWorkerGlobalScope

interface PyodideInterface {
  runPythonAsync(code: string): Promise<any>
  loadPackage(packages: string[]): Promise<void>
  FS: {
    mkdirTree(path: string): void
    writeFile(path: string, data: string): void
    readFile(path: string, opts?: { encoding?: string }): string | Uint8Array
    readdir(path: string): string[]
    stat(path: string): { mode: number }
    analyzePath(path: string): { exists: boolean }
  }
  globals: {
    get(name: string): any
    set(name: string, value: any): void
  }
  setStdout(options: { batched: (msg: string) => void }): void
  setStderr(options: { batched: (msg: string) => void }): void
}

declare function loadPyodide(options?: Record<string, unknown>): Promise<PyodideInterface>

let pyodide: PyodideInterface | null = null
const logs: string[] = []

const WORKSPACE = '/workspace'

async function initPyodide() {
  if (pyodide) return pyodide

  importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js')
  pyodide = await loadPyodide()

  pyodide.setStdout({
    batched: (msg: string) => {
      logs.push(msg)
      workerSelf.postMessage({ type: 'log', level: 'info', message: msg })
    }
  })

  pyodide.setStderr({
    batched: (msg: string) => {
      logs.push(`[stderr] ${msg}`)
      workerSelf.postMessage({ type: 'log', level: 'error', message: msg })
    }
  })

  // Pre-install pyodide-http to enable requests/httpx in browser
  await pyodide.loadPackage(['micropip'])
  await pyodide.runPythonAsync(`
import micropip
await micropip.install('pyodide-http')
import pyodide_http
pyodide_http.patch_all()
`)

  // Create the generic workspace and pin it as the cwd + sys.path entry.
  // The sandbox has no notion of "skills" anymore — it's a plain scratch dir.
  pyodide.FS.mkdirTree(WORKSPACE)
  await pyodide.runPythonAsync(`
import os, sys
os.chdir(${JSON.stringify(WORKSPACE)})
if ${JSON.stringify(WORKSPACE)} not in sys.path:
    sys.path.insert(0, ${JSON.stringify(WORKSPACE)})
`)

  workerSelf.postMessage({ type: 'log', level: 'info', message: `Sandbox ready; cwd=${WORKSPACE}` })

  return pyodide
}

const installedPackages = new Set<string>()

async function installPackages(packages: string[]) {
  const py = await initPyodide()
  for (const pkg of packages) {
    if (installedPackages.has(pkg)) continue
    try {
      await py.runPythonAsync(`import micropip; await micropip.install('${pkg}')`)
      installedPackages.add(pkg)
      workerSelf.postMessage({ type: 'log', level: 'info', message: `Installed: ${pkg}` })
    } catch (e: any) {
      workerSelf.postMessage({ type: 'log', level: 'error', message: `Failed to install ${pkg}: ${e.message}` })
    }
  }
}

/** Normalize a user-supplied path to an absolute path under /workspace. */
function resolveSandboxPath(path: string): string {
  if (path.startsWith('/')) return path
  return `${WORKSPACE}/${path}`
}

/** Drop cached modules whose __file__ is inside /workspace so edits take effect. */
async function invalidateWorkspaceModules(py: PyodideInterface) {
  await py.runPythonAsync(`
import sys
_ws = ${JSON.stringify(WORKSPACE)}
for _m in list(sys.modules.keys()):
    _mod = sys.modules[_m]
    if hasattr(_mod, '__file__') and _mod.__file__ and _mod.__file__.startswith(_ws):
        del sys.modules[_m]
`)
}

async function fsWrite(path: string, content: string): Promise<{ success: boolean; error?: string; path: string }> {
  const py = await initPyodide()
  const abs = resolveSandboxPath(path)
  try {
    // Ensure parent dirs exist
    const lastSlash = abs.lastIndexOf('/')
    if (lastSlash > 0) py.FS.mkdirTree(abs.slice(0, lastSlash))
    py.FS.writeFile(abs, content)
    return { success: true, path: abs }
  } catch (e: any) {
    return { success: false, error: e.message, path: abs }
  }
}

async function fsRead(path: string): Promise<{ success: boolean; content?: string; error?: string; path: string }> {
  const py = await initPyodide()
  const abs = resolveSandboxPath(path)
  try {
    const data = py.FS.readFile(abs, { encoding: 'utf8' }) as string
    return { success: true, content: data, path: abs }
  } catch (e: any) {
    return { success: false, error: e.message, path: abs }
  }
}

async function fsList(path?: string): Promise<{ success: boolean; entries?: Array<{ name: string; type: 'file' | 'dir' }>; error?: string; path: string }> {
  const py = await initPyodide()
  const abs = resolveSandboxPath(path ?? '')
  try {
    const names = py.FS.readdir(abs).filter((n: string) => n !== '.' && n !== '..')
    const entries = names.map((name: string) => {
      try {
        const stat = py.FS.stat(`${abs}/${name}`)
        // Pyodide FS uses Linux mode bits: S_IFDIR = 0o040000
        const isDir = (stat.mode & 0o170000) === 0o040000
        return { name, type: (isDir ? 'dir' : 'file') as 'file' | 'dir' }
      } catch {
        return { name, type: 'file' as const }
      }
    })
    return { success: true, entries, path: abs }
  } catch (e: any) {
    return { success: false, error: e.message, path: abs }
  }
}

async function executeCode(
  command: string,
  envVars?: Record<string, string>,
): Promise<{ success: boolean; output: string; error?: string; logs: string[] }> {
  const py = await initPyodide()
  logs.length = 0

  try {
    // Apply env vars and reset cwd to workspace for each invocation
    await py.runPythonAsync(`
import os
os.chdir(${JSON.stringify(WORKSPACE)})
${envVars && Object.keys(envVars).length > 0 ? `os.environ.update(${JSON.stringify(envVars)})` : ''}
`)

    // Clear cached modules so edits via write_file take effect on re-import
    await invalidateWorkspaceModules(py)

    // Shell-like syntax:
    //   python script.py --arg val   → runpy
    //   python -c "code"             → inline exec
    //   raw Python expression        → direct
    const pythonScriptMatch = command.match(/^python\s+(\S+\.py)(.*)?$/)
    const pythonInlineMatch = command.match(/^python\s+-c\s+["'`]([\s\S]*?)["'`]\s*$/)

    if (pythonInlineMatch) {
      await py.runPythonAsync(pythonInlineMatch[1])
    } else if (pythonScriptMatch) {
      const scriptArg = pythonScriptMatch[1]
      const argsStr = (pythonScriptMatch[2] || '').trim()
      const scriptPath = scriptArg.startsWith('/') ? scriptArg : `${WORKSPACE}/${scriptArg}`

      await py.runPythonAsync(`
import shlex, sys
sys.argv = [${JSON.stringify(scriptPath)}] + shlex.split(${JSON.stringify(argsStr)})
`)
      await py.runPythonAsync(`
import runpy
runpy.run_path(${JSON.stringify(scriptPath)}, run_name='__main__')
`)
    } else {
      await py.runPythonAsync(command)
    }

    const output = logs.join('\n')
    return { success: true, output, logs: [...logs] }
  } catch (e: any) {
    return { success: false, output: '', error: e.message, logs: [...logs] }
  }
}

workerSelf.onmessage = async (event: MessageEvent) => {
  const { id, action, payload } = event.data

  try {
    switch (action) {
      case 'init': {
        await initPyodide()
        workerSelf.postMessage({ id, type: 'result', data: { success: true } })
        break
      }
      case 'install': {
        await installPackages(payload.packages)
        workerSelf.postMessage({ id, type: 'result', data: { success: true } })
        break
      }
      case 'execute': {
        const result = await executeCode(payload.command, payload.envVars)
        workerSelf.postMessage({ id, type: 'result', data: result })
        break
      }
      case 'fs_write': {
        const result = await fsWrite(payload.path, payload.content)
        workerSelf.postMessage({ id, type: 'result', data: result })
        break
      }
      case 'fs_read': {
        const result = await fsRead(payload.path)
        workerSelf.postMessage({ id, type: 'result', data: result })
        break
      }
      case 'fs_list': {
        const result = await fsList(payload.path)
        workerSelf.postMessage({ id, type: 'result', data: result })
        break
      }
      default:
        workerSelf.postMessage({ id, type: 'result', data: { success: false, error: `Unknown action: ${action}` } })
    }
  } catch (e: any) {
    workerSelf.postMessage({ id, type: 'result', data: { success: false, error: e.message } })
  }
}
