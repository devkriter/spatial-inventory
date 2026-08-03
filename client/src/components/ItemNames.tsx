import type { Item } from '../types';

/**
 * One shared `<datalist>` of every item already in the catalogue. Referenced by
 * id from any name field, so typing "10k" offers "10k Resistor" instead of
 * quietly creating a second entry that differs only in spelling.
 */
export const ITEM_NAME_LIST = 'known-item-names';

export function ItemNames({ items }: { items: Item[] }) {
  return (
    <datalist id={ITEM_NAME_LIST}>
      {items.map((p) => (
        <option key={p.id} value={p.name} />
      ))}
    </datalist>
  );
}
