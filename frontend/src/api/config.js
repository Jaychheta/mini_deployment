/**
 * config.js — Dynamic environment and backend configuration helper.
 */

export const getBackendUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '');
  }
  if (typeof window !== 'undefined') {
    // If running in local development on Vite dev server (port 5173), point to local backend port 3001
    if (window.location.hostname === 'localhost' && window.location.port === '5173') {
      return 'http://localhost:3001';
    }
    // In production (or when accessed from another PC/phone/domain), use current window origin!
    return window.location.origin;
  }
  return '';
};
