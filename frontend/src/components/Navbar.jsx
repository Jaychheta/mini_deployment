/**
 * Navbar.jsx — Top navigation bar.
 *
 * Shows different links for USER and ADMIN roles.
 * Reads the active route to highlight the current nav item.
 *
 * @param {'user' | 'admin'} role
 */

import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar({ role = 'user' }) {
  const { user, logout } = useAuth();

  const userLinks = [
    { to: '/dashboard',   label: 'Dashboard' },
    { to: '/projects',    label: 'Projects' },
    { to: '/deployments', label: 'Deployments' },
  ];

  const adminLinks = [
    { to: '/admin/dashboard',   label: 'Dashboard' },
    { to: '/admin/users',       label: 'Users' },
    { to: '/admin/projects',    label: 'Projects' },
    { to: '/admin/deployments', label: 'Deployments' },
  ];

  const links = role === 'admin' ? adminLinks : userLinks;

  return (
    <nav className="navbar">
      <div className="container">
        <div className="navbar-inner">
          {/* Brand */}
          <div className="navbar-brand">
            <div className="navbar-brand-dot" />
            Mini Deploy Platform
            {role === 'admin' && (
              <span style={{
                fontSize: '0.7rem', fontWeight: 600,
                background: '#fef3c7', color: '#92400e',
                padding: '2px 8px', borderRadius: 99, border: '1px solid #fde68a',
              }}>
                Admin
              </span>
            )}
          </div>

          {/* Nav links */}
          <ul className="navbar-links">
            {links.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>

          {/* Right side: user name + logout */}
          <div className="navbar-right">
            {user && <span className="navbar-user">{user.name}</span>}
            <button className="btn btn-ghost btn-sm" onClick={logout}>
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
