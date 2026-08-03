import type { Holding, Node } from './types';
import type { Tree } from './tree';

export interface Hit {
  score: number;
  node: Node;
  holding?: Holding;
}

export interface SearchResult {
  hits: Hit[];
  /** Space ids that matched, or that hold a matching item. */
  matched: Set<number>;
  /** Holding row ids whose item matched. */
  matchedHoldings: Set<number>;
  /** Ancestors of matches, so collapsed branches can show a trail. */
  onPath: Set<number>;
}

export const emptySearch: SearchResult = {
  hits: [],
  matched: new Set(),
  matchedHoldings: new Set(),
  onPath: new Set(),
};

/**
 * Token-AND matching: every whitespace-separated token must appear somewhere in
 * the haystack. That handles `470 resistor` and `esp32 mini` the way you'd
 * expect while staying predictable — no fuzzy near-misses on an inventory where
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
  const matchedHoldings = new Set<number>();

  for (const node of tree.flat) {
    const spaceScore = scoreText(
      [node.space.name, node.type?.name ?? '', node.space.notes ?? ''].join(' '),
      tokens
    );
    if (spaceScore > 0) {
      hits.push({ score: spaceScore + 1, node });
      matched.add(node.space.id);
    }

    for (const holding of node.holdings) {
      const item = holding.item;
      const haystack = [
        item.name, item.description, item.part_number, item.manufacturer,
        item.category, item.tags, item.package, item.value, item.notes, holding.row.note,
      ]
        .filter(Boolean)
        .join(' ');
      const itemScore = scoreText(haystack, tokens);
      if (itemScore > 0) {
        hits.push({ score: itemScore, node, holding });
        matched.add(node.space.id);
        matchedHoldings.add(holding.row.id);
      }
    }
  }

  const onPath = new Set<number>();
  for (const id of matched) {
    let cursor = tree.byId.get(id)?.parent ?? null;
    while (cursor) {
      onPath.add(cursor.space.id);
      cursor = cursor.parent;
    }
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (a.holding?.item.name ?? a.node.space.name).localeCompare(
        b.holding?.item.name ?? b.node.space.name,
        undefined,
        { numeric: true }
      )
  );

  return { hits, matched, matchedHoldings, onPath };
}
