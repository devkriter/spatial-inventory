import type { Node } from './types';

/**
 * Swatches offered for a space or a space type, in four rows of six: neutrals,
 * blues, greens, warms.
 *
 * Everything is matte on purpose — roughly 10–30% saturation and 40–70%
 * lightness. `fillStyle` lifts the top-left corner 15% towards white and drops
 * the bottom-right towards black, so a saturated colour arrives on screen far
 * louder than it looks here, and a wall of loud blocks tells you nothing.
 *
 * The old set was half a dozen browns a shade apart, which is why a workshop
 * came out uniformly tan. The browns that remain are the distinguishable ones.
 * Every colour that was previously offered and is still worth having is kept at
 * its exact hex, so nothing already chosen shifts underfoot.
 */
export const SWATCHES = [
  // neutral — bone through charcoal. Light ones take dark ink automatically.
  '#e3e1dc', '#bcc0c5', '#969ca4', '#757c85', '#565d66', '#3f454d',
  // blue
  '#aac6de', '#86aacb', '#5f8bb2', '#4a6b8a', '#3a5573', '#2f4459',
  // green and teal
  '#a6b78f', '#869a6b', '#6f7c52', '#5f9088', '#4f7a72', '#3d5f55',
  // warm
  '#cfa87a', '#a07a4a', '#8a6a45', '#a2705c', '#8a5060', '#6a5a86',
];

/** A container's own colour wins, then its type's, then the depth default. */
export const colorOf = (node: Node): string | null => node.c.color || node.type?.color || null;

export const typeName = (node: Node): string => node.type?.name ?? 'Untyped';
