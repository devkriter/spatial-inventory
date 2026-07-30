import type { Item, Node } from './types';
import type { Tree } from './tree';

export interface Hit {
  score: number;
  node: Node;
  item?: Item;
}

export interface SearchResult {
  hits: Hit[];
  /** Container ids that matched, or that hold a matching part. */
  matched: Set<number>;
  /** Stock row ids whose part matched. */
  matchedStock: Set<number>;
  /** Ancestors of matches, so collapsed branches can show a trail. */
  onPath: Set<number>;
}

export const emptySearch: SearchResult = {
  hits: [],
  matched: new Set(),
  matchedStock: new Set(),
  onPath: new Set(),
};

/**
 * Token-AND matching: every whitespace-separated token must appear somewhere in
 * the haystack. That handles `470 resistor` and `esp32 mini` the way you'd
 * expect while staying predictable — no fuzzy near-misses on a parts list where
 * `10K` and `100K` are different things.
 */
function scoreText(haystack: string, tokens: string[]): number {
  const hay = haystack.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    const at = hay.indexOf(token);
    if (at < 0) return 0;
    // Prefer matches at the start, and whole-word matches over substrings.
    score += at === 0 ? 3 : /\W/.test(hay[at - 1] ?? '') ? 2 : 1;
  }
  return score;
}

export function search(tree: Tree, query: string): SearchResult {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return emptySearch;

  const hits: Hit[] = [];
  const matched = new Set<number>();
  const matchedStock = new Set<number>();

  for (const node of tree.flat) {
    const containerScore = scoreText(
      [node.c.name, node.type?.name ?? '', node.c.notes ?? ''].join(' '),
      tokens
    );
    if (containerScore > 0) {
      hits.push({ score: containerScore + 1, node });
      matched.add(node.c.id);
    }

    for (const item of node.items) {
      const p = item.part;
      const haystack = [
        p.name, p.description, p.part_number, p.manufacturer,
        p.category, p.tags, p.package, p.value, p.notes, item.stock.note,
      ]
        .filter(Boolean)
        .join(' ');
      const itemScore = scoreText(haystack, tokens);
      if (itemScore > 0) {
        hits.push({ score: itemScore, node, item });
        matched.add(node.c.id);
        matchedStock.add(item.stock.id);
      }
    }
  }

  const onPath = new Set<number>();
  for (const id of matched) {
    let cursor = tree.byId.get(id)?.parent ?? null;
    while (cursor) {
      onPath.add(cursor.c.id);
      cursor = cursor.parent;
    }
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (a.item?.part.name ?? a.node.c.name).localeCompare(
        b.item?.part.name ?? b.node.c.name,
        undefined,
        { numeric: true }
      )
  );

  return { hits, matched, matchedStock, onPath };
}
