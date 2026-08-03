import type { HoldingRow, Item, RootSpace, Space, SpaceType, State } from './types';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error || `${method} ${url} failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  state: () => request<State>('GET', '/api/state'),

  updateRootSpace: (data: Partial<RootSpace>) =>
    request<RootSpace>('PATCH', '/api/root-space', data),

  createType: (data: Partial<SpaceType>) => request<SpaceType>('POST', '/api/space-types', data),
  updateType: (id: number, data: Partial<SpaceType>) =>
    request<SpaceType>('PATCH', `/api/space-types/${id}`, data),
  deleteType: (id: number) => request<void>('DELETE', `/api/space-types/${id}`),

  createSpace: (data: Partial<Space>) => request<Space>('POST', '/api/spaces', data),
  updateSpace: (id: number, data: Partial<Space>) =>
    request<Space>('PATCH', `/api/spaces/${id}`, data),
  deleteSpace: (id: number) => request<void>('DELETE', `/api/spaces/${id}`),

  createItem: (data: Partial<Item>) => request<Item>('POST', '/api/items', data),
  updateItem: (id: number, data: Partial<Item>) => request<Item>('PATCH', `/api/items/${id}`, data),
  deleteItem: (id: number) => request<void>('DELETE', `/api/items/${id}`),

  /** Adds `qty` to an existing holding, or creates the item and the holding. */
  addHolding: (data: { space_id: number; item_id?: number; name?: string; qty?: number; note?: string }) =>
    request<HoldingRow>('POST', '/api/holdings', data),
  updateHolding: (id: number, data: Partial<HoldingRow>) =>
    request<HoldingRow>('PATCH', `/api/holdings/${id}`, data),
  deleteHolding: (id: number) => request<void>('DELETE', `/api/holdings/${id}`),

  exportAll: () => request<unknown>('GET', '/api/export'),
  importAll: (dump: unknown) => request<unknown>('POST', '/api/import', dump),
};
