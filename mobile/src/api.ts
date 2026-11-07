/** Cliente da API LendControl para o app. Servidor e token ficam no SecureStore do aparelho. */
import * as SecureStore from 'expo-secure-store';

const K_SERVER = 'lendcontrol.server';
const K_TOKEN = 'lendcontrol.token';

let server = '';
let token = '';

export async function loadSession() {
  server = (await SecureStore.getItemAsync(K_SERVER)) ?? '';
  token = (await SecureStore.getItemAsync(K_TOKEN)) ?? '';
  return { server, token };
}

export async function saveSession(s: string, t: string) {
  server = s.replace(/\/+$/, '');
  token = t;
  await SecureStore.setItemAsync(K_SERVER, server);
  await SecureStore.setItemAsync(K_TOKEN, token);
}

export async function logout() {
  token = '';
  await SecureStore.deleteItemAsync(K_TOKEN);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onUnauthorized: () => void = () => undefined;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${server}/api${path}`, {
      method: method ?? (body !== undefined ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Confira a internet e o endereço.');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
  if (!r.ok) {
    const m = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new ApiError(r.status, m || `Erro ${r.status}`);
  }
  return data as T;
}

export async function login(srv: string, email: string, password: string) {
  server = srv.trim().replace(/\/+$/, '').replace(/\/api$/i, ''); // aceita com ou sem /api no fim
  token = '';
  const r = await api<{ accessToken: string; user: Me }>('/auth/login', { email: email.trim().toLowerCase(), password });
  await saveSession(server, r.accessToken);
  return r.user;
}

export interface Me {
  id: string;
  name: string;
  role: 'SUPER_ADMIN' | 'DONO' | 'FUNCIONARIO';
}

export const brl = (v: unknown) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const date = (v: unknown) => {
  if (!v) return '—';
  const d = new Date(String(v));
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

export const waLink = (phone: string, text: string) => {
  const d = phone.replace(/\D/g, '');
  return `https://wa.me/${d.startsWith('55') && d.length >= 12 ? d : `55${d}`}?text=${encodeURIComponent(text)}`;
};
