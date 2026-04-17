// This module runs in a Web Worker. Cast the global `self` to the worker scope
// so the DOM `self: Window` typing from the shared lib doesn't apply here.
const workerSelf = self as unknown as DedicatedWorkerGlobalScope

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
  workerSelf.postMessage({ type: 'log', level: 'info', message: 'pyodide-http patched (requests/httpx enabled)' })

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

// Scan Python code for import statements and return package names
function extractImports(codeFiles: { name: string; content: string }[]): string[] {
  const imports = new Set<string>()
  // Modules that are built-in to Python or Pyodide, skip these
  const builtins = new Set([
    'sys', 'os', 'json', 're', 'math', 'random', 'datetime', 'time',
    'collections', 'itertools', 'functools', 'typing', 'pathlib',
    'io', 'string', 'hashlib', 'base64', 'urllib', 'copy', 'enum',
    'dataclasses', 'abc', 'contextlib', 'textwrap', 'csv', 'struct',
    'argparse', 'shlex', 'runpy', 'subprocess', 'shutil', 'glob',
    'logging', 'unittest', 'traceback', 'inspect', 'operator',
    'threading', 'multiprocessing', 'socket', 'http', 'email',
    'html', 'xml', 'sqlite3', 'decimal', 'fractions', 'statistics',
    'secrets', 'tempfile', 'zipfile', 'tarfile', 'gzip', 'bz2',
    'pickle', 'shelve', 'configparser', 'pprint', 'warnings',
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

  // Filter out skill-internal modules (file basenames and directory names)
  const localModules = new Set<string>()
  for (const f of codeFiles) {
    const parts = f.name.split('/')
    // Add file basename without .py
    const fileName = parts.pop() || ''
    localModules.add(fileName.replace(/\.py$/, ''))
    // Add all directory names in the path (e.g. "scripts" from "skill/scripts/analyzer.py")
    for (const dir of parts) {
      localModules.add(dir)
    }
  }
  return [...imports].filter(pkg => !localModules.has(pkg))
}

const SKILLS_DIR = '/home/pyodide/skills'

async function executeCode(
  codeFiles: { name: string; content: string }[],
  callExpression: string,
  envVars?: Record<string, string>
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
      // Also add all ancestor directories between SKILLS_DIR and dirPath
      // so that subdirectories like "scripts/" are importable as packages
      for (let i = 1; i <= parts.length; i++) {
        dirs.add([SKILLS_DIR, ...parts.slice(0, i)].join('/'))
      }
      py.FS.mkdirTree(dirPath)
      py.FS.writeFile(`${dirPath}/${fileName}`, file.content)
      workerSelf.postMessage({ type: 'log', level: 'info', message: `Wrote ${dirPath}/${fileName}` })
    }

    // Ensure each directory has __init__.py so subpackages are importable
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

    // Set environment variables and working directory
    // Default cwd to the first skill's root directory
    const skillRoot = codeFiles.length > 0
      ? `${SKILLS_DIR}/${codeFiles[0].name.split('/')[0]}`
      : SKILLS_DIR
    await py.runPythonAsync(`
import os
os.chdir(${JSON.stringify(skillRoot)})
${envVars && Object.keys(envVars).length > 0 ? `os.environ.update(${JSON.stringify(envVars)})` : ''}
`)

    // Execute the command — supports shell-like syntax:
    //   python script.py --arg val   → run script via runpy with sys.argv
    //   python -c "code"             → run inline Python code
    //   raw Python expression        → run directly via runPythonAsync (legacy)
    const pythonScriptMatch = callExpression.match(/^python\s+(\S+\.py)(.*)?$/)
    const pythonInlineMatch = callExpression.match(/^python\s+-c\s+["'`]([\s\S]*?)["'`]\s*$/)

    if (pythonInlineMatch) {
      // python -c "code"
      await py.runPythonAsync(pythonInlineMatch[1])
    } else if (pythonScriptMatch) {
      // python script.py --args
      const scriptArg = pythonScriptMatch[1]
      const argsStr = (pythonScriptMatch[2] || '').trim()

      // Resolve script path in the virtual filesystem
      const scriptFile = codeFiles.find(f =>
        f.name.endsWith(`/${scriptArg}`) || f.name === scriptArg
      )
      const scriptPath = scriptFile
        ? `${SKILLS_DIR}/${scriptFile.name}`
        : `${SKILLS_DIR}/${scriptArg}`

      await py.runPythonAsync(`
import shlex, sys
sys.argv = [${JSON.stringify(scriptPath)}] + shlex.split(${JSON.stringify(argsStr)})
`)
      await py.runPythonAsync(`
import runpy
runpy.run_path(${JSON.stringify(scriptPath)}, run_name='__main__')
`)
    } else {
      // Raw Python expression (legacy / fallback)
      await py.runPythonAsync(callExpression)
    }
    // Output is captured via stdout/stderr → logs. Never use runPythonAsync
    // return values as they may be Pyodide proxy objects that can't be cloned.
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
        const result = await executeCode(payload.codeFiles, payload.callExpression, payload.envVars)
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
