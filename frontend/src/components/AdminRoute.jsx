/**
 * AdminRoute.jsx — Guards admin-only pages.
 *
 * If not logged in → redirect to /admin/login
 * If logged in as USER → redirect to /dashboard (not allowed in admin area)
 * If logged in as ADMIN → render the child routes
 */

import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AdminRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-page">
        <div className="spinner" />
        <span>Loading...</span>
      </div>
    );
  }

  if (!user) return <Navigate to="/admin/login" replace />;

  // Normal users cannot access admin area — send them to their dashboard
  if (user.role !== 'ADMIN') return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
