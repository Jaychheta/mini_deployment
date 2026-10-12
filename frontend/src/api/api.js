/**
 * api.js — Centralized API helper for the frontend.
 *
 * All HTTP requests to the backend go through this module.
 * It automatically attaches the JWT Authorization header when a token is stored.
 *
 * Usage:
 *   import { apiGet, apiPost } from '../api/api';
 *   const data = await apiGet('/projects');
 *   const result = await apiPost('/auth/login', { email, password });
 */

const BASE = import.meta.env.VITE_API_URL || '/api';

/** Read the JWT from localStorage. */
const getToken = () => localStorage.getItem('token');

/**
 * Core fetch wrapper — adds Content-Type and Authorization headers automatically.
 * Throws an Error with the server's error message on non-2xx responses.
 *
 * @param {string} path    — e.g. '/auth/login'
 * @param {RequestInit} options
 * @returns {Promise<any>}
 */
export const apiFetch = async (path, options = {}) => {
  const token = getToken();

  const headers = {
    'Content-Type': 'application/json',
    'Bypass-Tunnel-Reminder': 'true',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  // Try to parse JSON regardless of status, to extract error messages
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const message = json?.message || `HTTP ${res.status}`;
    throw new Error(message);
  }

  return json;
};

export const apiGet    = (path)       => apiFetch(path);
export const apiPost   = (path, body) => apiFetch(path, { method: 'POST',  body: JSON.stringify(body) });
export const apiDelete = (path)       => apiFetch(path, { method: 'DELETE' });
