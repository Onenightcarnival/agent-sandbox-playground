import { useCallback, useEffect, useState } from 'react'
import type { PyodideSandbox } from '@/sandbox/sandbox'
import './WorkspaceTree.css'

interface Props {
  sandbox: PyodideSandbox | null
  sandboxReady: boolean
  refreshKey: number
}

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

const ROOT = '/workspace'
const MAX_DEPTH = 8

async function buildTree(
  sandbox: PyodideSandbox,
  path: string,
  depth: number,
): Promise<TreeNode[]> {
  if (depth > MAX_DEPTH) return []
  const res = await sandbox.listDir(path)
  if (!res.success || !res.entries) return []
  const nodes: TreeNode[] = []
  // Dirs first, then files, each alphabetically.
  const sorted = [...res.entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const entry of sorted) {
    const childPath = `${path === '/' ? '' : path}/${entry.name}`
    const node: TreeNode = { name: entry.name, path: childPath, type: entry.type }
    if (entry.type === 'dir') {
      node.children = await buildTree(sandbox, childPath, depth + 1)
    }
    nodes.push(node)
  }
  return nodes
}

function TreeRow({ node, depth, expanded, onToggle }: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
}) {
  const isDir = node.type === 'dir'
  const isOpen = isDir && expanded.has(node.path)
  const hasChildren = isDir && (node.children?.length ?? 0) > 0
  return (
    <>
      <div
        className={`tree-row ${isDir ? 'dir' : 'file'}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => isDir && onToggle(node.path)}
      >
        <span className="tree-caret">
          {isDir ? (hasChildren ? (isOpen ? '▾' : '▸') : '·') : ''}
        </span>
        <span className="tree-icon">{isDir ? '📁' : '📄'}</span>
        <span className="tree-name">{node.name}</span>
      </div>
      {isOpen && node.children?.map(child => (
        <TreeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </>
  )
}

export default function WorkspaceTree({ sandbox, sandboxReady, refreshKey }: Props) {
  const [tree, setTree] = useState<TreeNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    if (!sandbox || !sandboxReady) return
    setLoading(true)
    setError(null)
    try {
      const nodes = await buildTree(sandbox, ROOT, 0)
      setTree(nodes)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [sandbox, sandboxReady])

  useEffect(() => {
    refresh()
  }, [refresh, refreshKey])

  const toggle = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    if (!tree) return
    const all = new Set<string>()
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === 'dir') {
          all.add(n.path)
          if (n.children) walk(n.children)
        }
      }
    }
    walk(tree)
    setExpanded(all)
  }, [tree])

  const collapseAll = useCallback(() => setExpanded(new Set()), [])

  return (
    <div className="workspace-tree">
      <div className="workspace-toolbar">
        <span className="workspace-root">{ROOT}</span>
        <div className="workspace-actions">
          <button onClick={expandAll} disabled={!tree?.length}>Expand</button>
          <button onClick={collapseAll} disabled={!tree?.length}>Collapse</button>
          <button onClick={refresh} disabled={loading || !sandboxReady}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      <div className="workspace-body">
        {!sandboxReady ? (
          <div className="workspace-empty">Sandbox not ready.</div>
        ) : error ? (
          <div className="workspace-error">{error}</div>
        ) : tree === null ? (
          <div className="workspace-empty">Loading…</div>
        ) : tree.length === 0 ? (
          <div className="workspace-empty">(empty)</div>
        ) : (
          tree.map(node => (
            <TreeRow
              key={node.path}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
            />
          ))
        )}
      </div>
    </div>
  )
}
