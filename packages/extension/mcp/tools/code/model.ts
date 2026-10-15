import type { GetCodeWarning } from '@tempad-dev/shared'

export type DataHint = Record<string, string>

/** 当前节点自身是 Figma mask 层（Agent 可见 hint）。 */
export const DATA_HINT_MASK = 'data-hint-mask'
/** 当前节点（通常为矢量导出根）子树包含 mask，遮罩已烘焙进 SVG 资产。 */
export const DATA_HINT_HAS_MASK = 'data-hint-has-mask'

export function pickMaskDataHints(dataHint?: DataHint): DataHint | undefined {
  if (!dataHint) return undefined
  const out: DataHint = {}
  if (dataHint[DATA_HINT_MASK]) out[DATA_HINT_MASK] = dataHint[DATA_HINT_MASK]
  if (dataHint[DATA_HINT_HAS_MASK]) out[DATA_HINT_HAS_MASK] = dataHint[DATA_HINT_HAS_MASK]
  return Object.keys(out).length ? out : undefined
}

export type AutoLayoutHint = 'none' | 'inferred'

export type NodeSnapshot = {
  id: string
  type: SceneNode['type']
  tag: string
  name: string
  visible: boolean
  parentId?: string
  children: string[]
  bounds: { x: number; y: number; width: number; height: number }
  renderBounds?: { x: number; y: number; width: number; height: number } | null
  assetKind?: 'vector' | 'image'
  dataHint?: DataHint
  autoLayoutHint?: AutoLayoutHint
  node: SceneNode
}

export type TreeStats = {
  totalNodes: number
  maxDepth: number
  depthLimit?: number
  capped: boolean
}

export type VisibleTree = {
  rootIds: string[]
  nodes: Map<string, NodeSnapshot>
  order: string[]
  stats: TreeStats
}

export type CollectedData = {
  threeDWarnings?: Map<string, GetCodeWarning>
  nodes: Map<string, NodeSnapshot>
  rootVideoPreviewAssetHashes: Set<string>
  styles: Map<string, Record<string, string>>
  textSegments: Map<string, StyledTextSegment[] | null>
  videoPreviewAssetHashes: Set<string>
}
