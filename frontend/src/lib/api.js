import axios from "axios";

export const BACKEND = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND}/api`;

export const http = axios.create({ baseURL: API });

export function wsUrl(code, role, token) {
  const base = BACKEND.replace(/^http/, "ws");
  const q = new URLSearchParams({ role });
  if (token) q.set("token", token);
  return `${base}/api/ws/${code}?${q.toString()}`;
}

export function loadPlayer(code) {
  try {
    const raw = localStorage.getItem(`versus_${code}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function savePlayer(code, data) {
  localStorage.setItem(`versus_${code}`, JSON.stringify(data));
}
