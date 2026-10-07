/**
 * App.jsx — Root component with React Router.
 *
 * Route structure:
 *   /                    → redirect to /login
 *   /login               → LoginPage (public)
 *   /signup              → SignupPage (public)
 *   /admin/login         → AdminLoginPage (public)
 *
 *   Protected (USER role):
 *   /dashboard           → DashboardPage
 *   /repositories        → RepositoriesPage  ← Phase 3: GitHub repo picker
 *   /projects            → ProjectsPage
 *   /projects/:id        → ProjectPage
 *   /deployments         → DeploymentsPage
 *   /deployments/:id     → DeploymentPage
 *
 *   Admin (ADMIN role):
 *   /admin/dashboard     → AdminDashboardPage
 *   /admin/users         → AdminUsersPage
 *   /admin/projects      → AdminProjectsPage
 *   /admin/deployments   → AdminDeploymentsPage
 */

import './index.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute     from './components/AdminRoute';

// Public pages
import LoginPage       from './pages/LoginPage';
import SignupPage      from './pages/SignupPage';
import AdminLoginPage  from './pages/admin/AdminLoginPage';

// User pages
import DashboardPage    from './pages/DashboardPage';
import RepositoriesPage from './pages/RepositoriesPage';
import ProjectsPage     from './pages/ProjectsPage';
import ProjectPage      from './pages/ProjectPage';
import DeploymentsPage  from './pages/DeploymentsPage';
import DeploymentPage   from './pages/DeploymentPage';

// Admin pages
import AdminDashboardPage   from './pages/admin/AdminDashboardPage';
import AdminUsersPage       from './pages/admin/AdminUsersPage';
import AdminProjectsPage    from './pages/admin/AdminProjectsPage';
import AdminDeploymentsPage from './pages/admin/AdminDeploymentsPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/login" replace />} />

          {/* Public routes */}
          <Route path="/login"       element={<LoginPage />} />
          <Route path="/signup"      element={<SignupPage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />

          {/* User-protected routes — requires login with role = USER */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard"        element={<DashboardPage />} />
            <Route path="/repositories"     element={<RepositoriesPage />} />
            <Route path="/projects"         element={<ProjectsPage />} />
            <Route path="/projects/:id"     element={<ProjectPage />} />
            <Route path="/deployments"      element={<DeploymentsPage />} />
            <Route path="/deployments/:id"  element={<DeploymentPage />} />
          </Route>

          {/* Admin-protected routes — requires login with role = ADMIN */}
          <Route element={<AdminRoute />}>
            <Route path="/admin/dashboard"   element={<AdminDashboardPage />} />
            <Route path="/admin/users"       element={<AdminUsersPage />} />
            <Route path="/admin/projects"    element={<AdminProjectsPage />} />
            <Route path="/admin/deployments" element={<AdminDeploymentsPage />} />
          </Route>

          {/* Catch-all — redirect unknown routes to login */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
