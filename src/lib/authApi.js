const API_BASE = import.meta.env.VITE_AUTH_API_URL || 'http://localhost:3001';

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Login gagal');
  }
  return data; // { token, username, nama, jabatan }
}

export async function verifyToken(token) {
  const res = await fetch(`${API_BASE}/api/verify`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json(); // { username, nama, jabatan }
}
