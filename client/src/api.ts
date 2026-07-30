import type { Container, Part, State, Stock, StorageType, Workspace } from './types';

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

  updateWorkspace: (data: Partial<Workspace>) =>
    request<Workspace>('PATCH', '/api/workspace', data),

  createType: (data: Partial<StorageType>) => request<StorageType>('POST', '/api/types', data),
  updateType: (id: number, data: Partial<StorageType>) =>
    request<StorageType>('PATCH', `/api/types/${id}`, data),
  deleteType: (id: number) => request<void>('DELETE', `/api/types/${id}`),

  createContainer: (data: Partial<Container>) =>
    request<Container>('POST', '/api/containers', data),
  updateContainer: (id: number, data: Partial<Container>) =>
    request<Container>('PATCH', `/api/containers/${id}`, data),
  deleteContainer: (id: number) => request<void>('DELETE', `/api/containers/${id}`),

  createPart: (data: Partial<Part>) => request<Part>('POST', '/api/parts', data),
  updatePart: (id: number, data: Partial<Part>) => request<Part>('PATCH', `/api/parts/${id}`, data),
  deletePart: (id: number) => request<void>('DELETE', `/api/parts/${id}`),

  /** Adds `qty` to an existing row, or creates the part and the row. */
  addStock: (data: { container_id: number; part_id?: number; name?: string; qty?: number; note?: string }) =>
    request<Stock>('POST', '/api/stock', data),
  updateStock: (id: number, data: Partial<Stock>) =>
    request<Stock>('PATCH', `/api/stock/${id}`, data),
  deleteStock: (id: number) => request<void>('DELETE', `/api/stock/${id}`),

  exportAll: () => request<unknown>('GET', '/api/export'),
  importAll: (dump: unknown) => request<unknown>('POST', '/api/import', dump),
};
