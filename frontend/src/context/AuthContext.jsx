/**
 * AuthContext.jsx — Global authentication state.
 *
 * Provides:
 *   user    — the logged-in user object ({ id, name, email, role }) or null
 *   token   — the JWT string or null
 *   loading — true while verifying the stored token on page load
 *   login   — function to set user + token after a successful login/signup
 *   logout  — function to clear user + token and redirect to /login
 *
 * On mount: reads the token from localStorage and calls /api/auth/me
 * to verify it is still valid and get the current user profile.
 *
 * Usage anywhere in the tree:
 *   import { useAuth } from '../context/AuthContext';
 *   const { user, login, logout } = useAuth();
 */

import { createContext, useContext, useState, useEffect } from 'react';
import { apiGet, apiPost } from '../api/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount: validate any stored token
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }

    apiGet('/auth/me')
      .then((res) => setUser(res.data))
      .catch(() => {
        // Token is invalid or expired — clear it
        localStorage.removeItem('token');
      })
      .finally(() => setLoading(false));
  }, []);

  /**
   * Call this after a successful login or signup API response.
   * @param {{ user, token }} data
   */
  const login = ({ user, token }) => {
    localStorage.setItem('token', token);
    setUser(user);
  };

  /** Clear auth state and token, then redirect to /login. */
  const logout = async () => {
    try {
      await apiPost('/auth/logout', {});
    } catch {
      // Ignore — we always clear locally even if the server call fails
    }
    localStorage.removeItem('token');
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Hook to access auth context. Must be used inside <AuthProvider>. */
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
