const TOKEN_KEY = 'providence_token';
const ROLE_KEY = 'providence_role';

const BASE = import.meta.env.VITE_API_URL ?? '';

export async function login(username: string, password: string): Promise<{ token: string; role: string }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('Invalid credentials');
  const data = await res.json();
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(ROLE_KEY, data.role);
  return data;
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  window.location.href = '/login';
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRole(): 'admin' | 'viewer' | null {
  return localStorage.getItem(ROLE_KEY) as 'admin' | 'viewer' | null;
}

export function isAdmin(): boolean {
  return getRole() === 'admin';
}
