import type { Part } from '../types';

/**
 * One shared `<datalist>` of every part already in the catalogue. Referenced by
 * id from any name field, so typing "10k" offers "10k Resistor" instead of
 * quietly creating a second entry that differs only in spelling.
 */
export const PART_NAME_LIST = 'known-part-names';

export function PartNames({ parts }: { parts: Part[] }) {
  return (
    <datalist id={PART_NAME_LIST}>
      {parts.map((p) => (
        <option key={p.id} value={p.name} />
      ))}
    </datalist>
  );
}
