import type { Node } from './types';

/** Swatches offered when defining a storage type. Warm, SpaceSniffer-ish. */
export const SWATCHES = [
  '#8a6a45', '#a07a4a', '#bb9159', '#96703f', '#7d6448', '#8f7550',
  '#6f7c52', '#4f7a72', '#4a6b8a', '#6a5a86', '#8a5060', '#7a4a3a',
];

/** A container's own colour wins, then its type's, then the depth default. */
export const colorOf = (node: Node): string | null => node.c.color || node.type?.color || null;

export const typeName = (node: Node): string => node.type?.name ?? 'Untyped';
