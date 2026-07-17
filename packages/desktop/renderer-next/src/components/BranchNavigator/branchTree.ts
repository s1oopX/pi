import type { ForkMessage, SessionTreeData, SessionTreeNode } from "../../ipc/types";

export interface BranchTreeRow {
  entryId: string;
  text: string;
  depth: number;
  branchCount: number;
  current: boolean;
}

interface TreePosition {
  depth: number;
  node: SessionTreeNode;
  order: number;
}

export function buildBranchTreeRows(
  data: SessionTreeData,
  forkMessages: readonly ForkMessage[],
): BranchTreeRow[] {
  const positions = new Map<string, TreePosition>();
  const parents = new Map<string, string | null>();
  let order = 0;

  const visit = (nodes: readonly SessionTreeNode[], depth: number) => {
    for (const node of nodes) {
      positions.set(node.entry.id, { depth, node, order: order++ });
      parents.set(node.entry.id, node.entry.parentId);
      visit(node.children, depth + 1);
    }
  };
  visit(data.tree, 0);

  const currentPath = new Set<string>();
  let cursor = data.leafId;
  while (cursor && !currentPath.has(cursor)) {
    currentPath.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }

  const positionedMessages = forkMessages
    .map((message) => ({ message, position: positions.get(message.entryId) }))
    .filter((item): item is { message: ForkMessage; position: TreePosition } => item.position !== undefined)
    .sort((left, right) => left.position.order - right.position.order);
  let currentEntryId: string | undefined;
  for (let index = positionedMessages.length - 1; index >= 0; index -= 1) {
    const entryId = positionedMessages[index].message.entryId;
    if (!currentPath.has(entryId)) continue;
    currentEntryId = entryId;
    break;
  }

  return positionedMessages.map(({ message, position }) => ({
    entryId: message.entryId,
    text: message.text,
    depth: position.depth,
    branchCount: position.node.children.length,
    current: message.entryId === currentEntryId,
  }));
}
