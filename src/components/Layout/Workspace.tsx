import FileTreeView, { type TreeNode } from '../FileTree/FileTreeView'

interface WorkspaceProps {
  selectedFilter: string
  treeData: TreeNode[]
}

function Workspace({ selectedFilter, treeData }: WorkspaceProps) {

  // Flatten tree and filter by type
  const flattenTree = (nodes: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = []

    const traverse = (node: TreeNode) => {
      if (node.type === 'file') {
        // Apply filter
        if (selectedFilter === 'all') {
          result.push(node)
        } else if (selectedFilter === 'imports' && node.storageType === 'import') {
          result.push(node)
        } else if (selectedFilter === 'references' && node.storageType === 'reference') {
          result.push(node)
        }
        // trash filter returns empty for now
      }

      if (node.children) {
        node.children.forEach(traverse)
      }
    }

    nodes.forEach(traverse)
    return result
  }

  const fileNodes = flattenTree(treeData)

  const handleNodeDoubleClick = async (node: TreeNode) => {
    if (node.type === 'file' && node.storageType === 'reference') {
      const fileId = parseInt(node.id.replace('file-', ''))
      try {
        const files = await window.electron.getAllFiles()
        const file = files.find(f => f.id === fileId)

        if (file?.path) {
          await window.electron.openFileInDefaultApp(file.path)
        }
      } catch (error) {
        console.error('Failed to open file:', error)
      }
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-900 p-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-slate-200 mb-1">
          {selectedFilter.charAt(0).toUpperCase() + selectedFilter.slice(1)}
        </h2>
        <p className="text-sm text-slate-400">
          {fileNodes.length} file{fileNodes.length !== 1 ? 's' : ''}
        </p>
      </div>

      <FileTreeView
        data={fileNodes}
        onNodeDoubleClick={handleNodeDoubleClick}
        hideActionButtons={true}
      />

      {fileNodes.length === 0 && (
        <div className="text-center py-12">
          <p className="text-slate-400">No files found</p>
        </div>
      )}
    </div>
  )
}

export default Workspace
