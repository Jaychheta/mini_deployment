/**
 * useApi.js — Legacy hook kept for compatibility.
 *
 * Phase 2: New pages use the api.js helper directly.
 * This hook is kept so any existing imports don't break.
 * It now uses the centralized apiFetch which includes the JWT token.
 */

import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../api/api';

export function useApi(endpoint) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await apiGet(endpoint);
      setData(json.data ?? json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { data, loading, error, refetch: fetch_ };
}
