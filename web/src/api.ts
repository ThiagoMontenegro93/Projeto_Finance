/** Cliente HTTP do painel. Token JWT guardado no localStorage. */
const KEY = 'lendcontrol.token';

export const auth = {
  get token() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  },
  set(t: string | null) {
    try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ignore */ }
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (r.status === 401 && !path.startsWith('/auth/login')) {
    auth.set(null);
    location.href = '/login';
  }
  const ct = r.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    const msg = typeof data === 'object' ? (Array.isArray(data.message) ? data.message.join(', ') : data.message) : data;
    throw new ApiError(r.status, msg || `Erro ${r.status}`);
  }
  return data as T;
}

/** Baixa um arquivo autenticado (Excel/CSV). */
export async function download(path: string, fallbackName: string) {
  const r = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (!r.ok) throw new ApiError(r.status, 'Falha ao baixar');
  const name = r.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const brl = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const pct = (v: unknown) => `${(Number(v ?? 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
export const date = (v: unknown) => {
  if (!v) return '—';
  const d = new Date(String(v));
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
};
export const daysLate = (due: string) => Math.max(0, Math.floor((Date.now() - new Date(due).getTime()) / 86_400_000));

export const METHODS = { DIARIO: 'Diário', SEMANAL: 'Semanal', QUINZENAL: 'Quinzenal', MENSAL: 'Mensal' } as const;
export const SCORE = {
  BOM: { icon: '⭐', label: 'Bom' },
  REGULAR: { icon: '•', label: 'Regular' },
  RUIM: { icon: '⚠️', label: 'Ruim' },
  PERDA: { icon: '💀', label: 'Perda' },
} as const;
