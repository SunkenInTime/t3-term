// Dev-only layout audit for perf passes (T3TERM_PERF). Mirrors the host tree
// from the mutation batches and estimates where Taffy repeats layout work.
//
// Taffy lays out a stretched child of a flex column twice: once to find its
// hypothetical width (indefinite) and once at the stretched width. The two
// calls use different cache keys, so every such level doubles the work below
// it. Measured in the gpuix test renderer: ten settings rows under six plain
// `flex column` wrappers draw in 110 ms; give the wrappers `width: "100%"`
// and they draw in 4 ms. A definite width makes both calls the same.
//
// The audit scores every node 2^(stretched auto-width levels above it) and
// lists the nodes where a definite width would save the most.
type Node = {
  id: number;
  type: string;
  parent: number | null;
  children: number[];
  style: Record<string, unknown>;
  text?: string;
  testId?: string;
};

const nodes = new Map<number, Node>();
let root: number | null = null;

function detach(id: number) {
  const node = nodes.get(id);
  if (!node || node.parent === null) return;
  const parent = nodes.get(node.parent);
  if (parent) parent.children = parent.children.filter((child) => child !== id);
  node.parent = null;
}

function destroy(id: number) {
  const node = nodes.get(id);
  if (!node) return;
  detach(id);
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes.delete(current.id);
    for (const child of current.children) {
      const next = nodes.get(child);
      if (next) stack.push(next);
    }
  }
}

export function auditApplyBatch(ops: unknown[][]) {
  for (const op of ops) {
    const [kind, a, b, c] = op as [string, number, unknown, unknown];
    switch (kind) {
      case "createElement":
        nodes.set(a, { id: a, type: String(b), parent: null, children: [], style: {} });
        break;
      case "destroyElement":
        destroy(a);
        break;
      case "appendChild": {
        const child = b as number;
        detach(child);
        const parent = nodes.get(a);
        const node = nodes.get(child);
        if (parent && node) {
          parent.children.push(child);
          node.parent = a;
        }
        break;
      }
      case "insertBefore": {
        const child = b as number;
        detach(child);
        const parent = nodes.get(a);
        const node = nodes.get(child);
        if (parent && node) {
          const index = parent.children.indexOf(c as number);
          parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
          node.parent = a;
        }
        break;
      }
      case "setStyle": {
        const node = nodes.get(a);
        if (node) node.style = (b ?? {}) as Record<string, unknown>;
        break;
      }
      case "setText": {
        const node = nodes.get(a);
        if (node) node.text = String(b);
        break;
      }
      case "setCustomProp": {
        const node = nodes.get(a);
        if (node && b === "testId") node.testId = String(c);
        break;
      }
      case "setRoot":
        root = a;
        break;
    }
  }
}

function isColumn(style: Record<string, unknown>) {
  return style.display === "flex" && (style.flexDirection === "column" || style.flexDirection === "column-reverse");
}

/** Whether `child` is laid out twice by its flex-column parent. */
function doubles(parent: Node, child: Node) {
  if (parent.type === "virtual-list" || !isColumn(parent.style)) return false;
  if (child.style.position === "absolute" || child.style.width !== undefined) return false;
  const align = child.style.alignSelf ?? parent.style.alignItems;
  return align === undefined || align === "stretch";
}

function firstText(node: Node, budget = { left: 200 }): string | undefined {
  if (budget.left-- <= 0) return undefined;
  if (node.text) return node.text;
  for (const child of node.children) {
    const found = nodes.get(child) && firstText(nodes.get(child)!, budget);
    if (found) return found;
  }
  return undefined;
}

function path(node: Node): string {
  const parts: string[] = [];
  let current: Node | undefined = node;
  while (current) {
    if (current.testId) parts.unshift(current.testId);
    current = current.parent === null ? undefined : nodes.get(current.parent);
  }
  return parts.join(" > ");
}

/** A text report: total estimated layout units and the best places for a definite width. */
export function layoutAuditReport(top = 30): string {
  if (root === null || !nodes.has(root)) return "no tree";
  const amp = new Map<number, number>();
  const subtree = new Map<number, number>();
  const order: Node[] = [];
  const stack: Array<[Node, number]> = [[nodes.get(root)!, 1]];
  while (stack.length > 0) {
    const [node, factor] = stack.pop()!;
    amp.set(node.id, factor);
    order.push(node);
    for (const childId of node.children) {
      const child = nodes.get(childId);
      if (child) stack.push([child, doubles(node, child) ? factor * 2 : factor]);
    }
  }
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const node = order[index]!;
    let sum = amp.get(node.id)!;
    for (const child of node.children) sum += subtree.get(child) ?? 0;
    subtree.set(node.id, sum);
  }
  const total = subtree.get(root) ?? 0;
  // Repeated rows share a signature (their style keys and their parent's), so
  // one line stands for all of them with the summed saving.
  const signature = (node: Node) => {
    const parent = node.parent === null ? undefined : nodes.get(node.parent);
    return `${node.type}|${Object.keys(node.style).sort().join(",")}|${parent ? Object.keys(parent.style).sort().join(",") : ""}|${amp.get(node.id)}`;
  };
  const grouped = new Map<string, { node: Node; saving: number; count: number }>();
  for (const node of order) {
    if (node.parent === null || !doubles(nodes.get(node.parent)!, node)) continue;
    const key = signature(node);
    const entry = grouped.get(key) ?? { node, saving: 0, count: 0 };
    entry.saving += (subtree.get(node.id) ?? 0) / 2;
    entry.count += 1;
    grouped.set(key, entry);
  }
  const candidates = [...grouped.values()].sort((a, b) => b.saving - a.saving).slice(0, top);
  const lines = [`nodes=${order.length} units=${Math.round(total)} (1 unit per node with no repeated layout)`];
  for (const { node, saving, count } of candidates) {
    const style = Object.keys(node.style).filter((key) => key !== "hover" && key !== "active").join(",");
    lines.push(
      `${Math.round(saving).toString().padStart(8)}  #${node.id}${count > 1 ? ` (+${count - 1} alike)` : ""} ${node.type} x${amp.get(node.id)} ` +
        `[${style.slice(0, 120)}] text="${(firstText(node) ?? "").slice(0, 40)}" path=${path(node)}`,
    );
  }
  return lines.join("\n");
}
