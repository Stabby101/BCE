import type { MissionBranch } from '../../mission/mission-tree';

export const NODE_W = 196;
export const NODE_H = 88;
const GAP_X = 30;
const ROW_H = 152;
const PAD = 26;

export interface PlacedNode {
    branch: MissionBranch;
    px: number;
    py: number;
}
export interface FlowEdge {
    gate: string;
    path: string;
    lx: number;
    ly: number;
}
export interface FlowLayout {
    nodes: PlacedNode[];
    edges: FlowEdge[];
    width: number;
    height: number;
}

export function layoutTree(branches: MissionBranch[]): FlowLayout {
    if (!branches.length) return { nodes: [], edges: [], width: 0, height: 0 };
    const byId = new Map(branches.map((b) => [b.branchId, b]));
    const childrenOf = new Map<string | null, MissionBranch[]>();
    for (const b of branches) {
        const key = b.parentBranchId && byId.has(b.parentBranchId) ? b.parentBranchId : null;
        const arr = childrenOf.get(key) ?? [];
        arr.push(b);
        childrenOf.set(key, arr);
    }
    const depth = new Map<string, number>();
    const xslot = new Map<string, number>();
    let nextLeaf = 0;
    const walk = (b: MissionBranch, d: number): number => {
        depth.set(b.branchId, d);
        const kids = childrenOf.get(b.branchId) ?? [];
        if (!kids.length) {
            const x = nextLeaf++;
            xslot.set(b.branchId, x);
            return x;
        }
        const xs = kids.map((k) => walk(k, d + 1));
        const x = (xs[0] + xs[xs.length - 1]) / 2;
        xslot.set(b.branchId, x);
        return x;
    };
    for (const r of childrenOf.get(null) ?? []) walk(r, 0);

    const colW = NODE_W + GAP_X;
    const nodes: PlacedNode[] = branches.map((b) => ({
        branch: b,
        px: PAD + (xslot.get(b.branchId) ?? 0) * colW,
        py: PAD + (depth.get(b.branchId) ?? 0) * ROW_H,
    }));
    const posOf = new Map(nodes.map((n) => [n.branch.branchId, n]));

    const edges: FlowEdge[] = [];
    for (const b of branches) {
        const parent = b.parentBranchId ? posOf.get(b.parentBranchId) : undefined;
        const child = posOf.get(b.branchId);
        if (!parent || !child) continue;
        const x1 = parent.px + NODE_W / 2;
        const y1 = parent.py + NODE_H;
        const x2 = child.px + NODE_W / 2;
        const y2 = child.py;
        const my = (y1 + y2) / 2;
        edges.push({ gate: b.outcomeGate, path: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`, lx: (x1 + x2) / 2, ly: my });
    }

    const width = Math.max(...nodes.map((n) => n.px)) + NODE_W + PAD;
    const height = Math.max(...nodes.map((n) => n.py)) + NODE_H + PAD;
    return { nodes, edges, width, height };
}
