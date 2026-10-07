/**
 * AdminLoginPage.jsx — Separate login page for admins.
 * Route: /admin/login
 *
 * Kept visually distinct from the user login page so it's clear
 * this is the admin area. The actual authentication call is identical —
 * the backend validates the role from the JWT.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../../api/api';
import { useAuth } from '../../context/AuthContext';

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [form,    setForm]    = useState({ email: '', password: '' });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) {
      setError('Please enter email and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiPost('/auth/login', form);

      // Only ADMIN accounts should access the admin area
      if (res.user.role !== 'ADMIN') {
        setError('This account does not have admin access.');
        return;
      }

      login(res);
      navigate('/admin/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-logo">
        <div className="auth-logo-title">
          <div className="auth-logo-dot" />
          Mini Deploy Platform
        </div>
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <span style={{
            fontSize: '0.75rem', fontWeight: 600,
            background: '#fef3c7', color: '#92400e',
            padding: '3px 10px', borderRadius: 99, border: '1px solid #fde68a',
          }}>
            Admin Area
          </span>
        </div>
      </div>

      <div className="auth-card">
        <h1 className="auth-heading">Admin Login</h1>
        <p className="auth-subheading">Sign in with your admin account</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              name="email"
              type="email"
              className="form-input"
              placeholder="admin@example.com"
              value={form.email}
              onChange={handleChange}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              name="password"
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange}
            />
          </div>

          <button
            id="admin-login-submit"
            type="submit"
            className="btn btn-primary btn-full btn-lg"
            disabled={loading}
            style={{ marginTop: 8 }}
          >
            {loading ? <span className="spinner" style={{ borderTopColor: 'white' }} /> : 'Admin Login'}
          </button>
        </form>

        {/* Development hint — remove in production */}
        <div className="alert alert-info" style={{ marginTop: 20, fontSize: '0.78rem' }}>
          <strong>Development credentials:</strong><br />
          admin@minideploy.com / Admin@123
        </div>
      </div>
    </div>
  );
}
