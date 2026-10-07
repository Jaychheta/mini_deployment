/**
 * ProtectedRoute.jsx — Guards user-facing pages.
 *
 * If not logged in → redirect to /login
 * If logged in as ADMIN → redirect to /admin/dashboard (admins use admin pages)
 * If logged in as USER → render the child routes
 */

import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-page">
        <div className="spinner" />
        <span>Loading...</span>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Admins should use the admin area
  if (user.role === 'ADMIN') return <Navigate to="/admin/dashboard" replace />;

  return <Outlet />;
}
