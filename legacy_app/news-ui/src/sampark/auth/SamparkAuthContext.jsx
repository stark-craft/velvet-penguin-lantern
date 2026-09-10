import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getAccessCapabilities, getViewerProfile, logoutCapabilitySession, unlockCapabilitySession } from '../../news-scrapper/api.js';

// Abstraction seam for current standalone auth vs future Sampark SSO.
// Current provider uses existing capability session (role+key + HttpOnly cookie) + viewer profile.
// Future SSO provider will replace unlock/logout with trusted Sampark identity without changing consumers.

const SamparkAuthContext = createContext(null);

export function SamparkAuthProvider({ children }) {
  const [viewer, setViewer] = useState(null);
  const [viewerLoading, setViewerLoading] = useState(true);
  const [capabilities, setCapabilities] = useState([]);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setCapabilitiesLoading(true);
    try {
      const cap = await getAccessCapabilities();
      setCapabilities(Array.isArray(cap?.capabilities) ? cap.capabilities : []);
      setError('');
    } catch (e) {
      setError(e?.message || 'Access could not be verified.');
      setCapabilities([]);
    } finally {
      setCapabilitiesLoading(false);
    }
    setViewerLoading(true);
    try {
      const prof = await getViewerProfile();
      setViewer(prof);
    } catch (e) {
      setViewer(null);
    } finally {
      setViewerLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (role, key) => {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) throw new Error('Enter an access key.');
    await unlockCapabilitySession(role, cleanKey);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await logoutCapabilitySession();
    await refresh();
  }, [refresh]);

  const value = {
    viewer,
    viewerLoading,
    capabilities,
    capabilitiesLoading,
    error,
    isPrivileged: capabilities.length > 0,
    refresh,
    login,
    logout,
    // SSO seam: future provider will set ssoMode true and supply samparkPrincipal
    ssoMode: false,
    samparkPrincipal: null,
  };

  return <SamparkAuthContext.Provider value={value}>{children}</SamparkAuthContext.Provider>;
}

export function useSamparkAuth() {
  const ctx = useContext(SamparkAuthContext);
  if (!ctx) throw new Error('useSamparkAuth must be used within SamparkAuthProvider');
  return ctx;
}

export default SamparkAuthContext;
