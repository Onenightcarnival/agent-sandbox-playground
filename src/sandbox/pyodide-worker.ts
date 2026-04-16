declare const self: DedicatedWorkerGlobalScope

interface PyodideInterface {
  runPythonAsync(code: string): Promise<any>
  loadPackage(packages: string[]): Promise<void>
  FS: {
    mkdirTree(path: string): void
    writeFile(path: string, data: string): void
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

async function initPyodide() {
  if (pyodide) return pyodide

  importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js')
  pyodide = await loadPyodide()

  pyodide.setStdout({
    batched: (msg: string) => {
      logs.push(msg)
      self.postMessage({ type: 'log', level: 'info', message: msg })
    }
  })

  pyodide.setStderr({
    batched: (msg: string) => {
      logs.push(`[stderr] ${msg}`)
      self.postMessage({ type: 'log', level: 'error', message: msg })
    }
  })

  // Pre-install pyodide-http to enable requests/httpx in browser
  await py.loadPackage(['micropip'])
  await py.runPythonAsync(`
import micropip
await micropip.install('pyodide-http')
import pyodide_http
pyodide_http.patch_all()
`)
  self.postMessage({ type: 'log', level: 'info', message: 'pyodide-http patched (requests/httpx enabled)' })

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
      self.postMessage({ type: 'log', level: 'info', message: `Installed: ${pkg}` })
    } catch (e: any) {
      self.postMessage({ type: 'log', level: 'error', message: `Failed to install ${pkg}: ${e.message}` })
    }
  }
}

// Scan Python code for import statements and return package names
function extractImports(codeFiles: { name: string; content: string }[]): string[] {
  const imports = new Set<string>()
  // Modules that are built-in to Python or Pyodide, skip these
  const builtins = new Set([
    'sys', 'os', 'json', 're', 'math', 'random', 'datetime', 'time',
    'collections', 'itertools', 'functools', 'typing', 'pathlib',
    'io', 'string', 'hashlib', 'base64', 'urllib', 'copy', 'enum',
    'dataclasses', 'abc', 'contextlib', 'textwrap', 'csv', 'struct',
    'pyodide', 'pyodide_http', 'micropip', 'js',
  ])

  for (const file of codeFiles) {
    for (const line of file.content.split('\n')) {
      const trimmed = line.trim()
      // import foo / import foo.bar
      let m = trimmed.match(/^import\s+([\w]+)/)
      if (m && !builtins.has(m[1])) imports.add(m[1])
      // from foo import ... / from foo.bar import ...
      m = trimmed.match(/^from\s+([\w]+)/)
      if (m && !builtins.has(m[1])) imports.add(m[1])
    }
  }

  // Filter out skill-internal modules (files in the codeFiles)
  const localModules = new Set(
    codeFiles.map(f => {
      const name = f.name.split('/').pop() || ''
      return name.replace(/\.py$/, '')
    })
  )
  return [...imports].filter(pkg => !localModules.has(pkg))
}

const SKILLS_DIR = '/home/pyodide/skills'

async function executeCode(
  codeFiles: { name: string; content: string }[],
  callExpression: string
): Promise<{ success: boolean; output: string; error?: string; logs: string[] }> {
  const py = await initPyodide()
  logs.length = 0

  try {
    // Write all .py files to the virtual filesystem so import works
    const dirs = new Set<string>()
    for (const file of codeFiles) {
      // file.name is like "skill-name/main.py" or "skill-name/sub/helpers.py"
      const parts = file.name.split('/')
      const fileName = parts.pop()!
      const dirPath = [SKILLS_DIR, ...parts].join('/')
      dirs.add(dirPath)
      py.FS.mkdirTree(dirPath)
      py.FS.writeFile(`${dirPath}/${fileName}`, file.content)
      self.postMessage({ type: 'log', level: 'info', message: `Wrote ${dirPath}/${fileName}` })
    }

    // Ensure each directory has __init__.py and is on sys.path
    for (const dir of dirs) {
      try { py.FS.writeFile(`${dir}/__init__.py`, '') } catch {}
    }

    // Auto-install packages detected from import statements
    const needed = extractImports(codeFiles)
    if (needed.length > 0) {
      await installPackages(needed)
    }

    // Add skills dir and each skill subdirectory to sys.path
    const addPathCode = `
import sys
_skills_dir = "${SKILLS_DIR}"
if _skills_dir not in sys.path:
    sys.path.insert(0, _skills_dir)
for _d in ${JSON.stringify([...dirs])}:
    if _d not in sys.path:
        sys.path.insert(0, _d)
# Clear module cache for fresh imports
for _mod_name in list(sys.modules.keys()):
    _mod = sys.modules[_mod_name]
    if hasattr(_mod, '__file__') and _mod.__file__ and _mod.__file__.startswith(_skills_dir):
        del sys.modules[_mod_name]
`
    await py.runPythonAsync(addPathCode)

    // Execute the call expression
    const result = await py.runPythonAsync(callExpression)
    const output = result !== undefined && result !== null ? String(result) : ''
    return { success: true, output, logs: [...logs] }
  } catch (e: any) {
    return { success: false, output: '', error: e.message, logs: [...logs] }
  }
}

self.onmessage = async (event: MessageEvent) => {
  const { id, action, payload } = event.data

  try {
    switch (action) {
      case 'init': {
        await initPyodide()
        self.postMessage({ id, type: 'result', data: { success: true } })
        break
      }
      case 'install': {
        await installPackages(payload.packages)
        self.postMessage({ id, type: 'result', data: { success: true } })
        break
      }
      case 'execute': {
        const result = await executeCode(payload.codeFiles, payload.callExpression)
        self.postMessage({ id, type: 'result', data: result })
        break
      }
      default:
        self.postMessage({ id, type: 'result', data: { success: false, error: `Unknown action: ${action}` } })
    }
  } catch (e: any) {
    self.postMessage({ id, type: 'result', data: { success: false, error: e.message } })
  }
}
