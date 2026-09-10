import React, { useState } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import Icon from '../news-scrapper/components/Icon.jsx';
import { useSamparkAuth } from './auth/SamparkAuthContext.jsx';

export default function SamparkLogin() {
  const navigate = useNavigate();
  const { capabilities, login } = useSamparkAuth();
  const [role, setRole] = useState('director');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await login(role, key);
      setSuccess('Access granted. Opening TechScout…');
      setTimeout(() => navigate('/for-you', { replace: true }), 600);
    } catch (err) {
      setError(err?.message || 'Those credentials were not accepted.');
    } finally {
      setBusy(false);
    }
  };

  const isAuthed = capabilities.length > 0;

  return (
    <div className="sampark-login-page">
      <div className="sampark-login-card">
        <div className="sampark-login-brand">
          <span className="sampark-login-logo"><span className="logo-samsung">Samsung</span><span className="logo-techscout">TechScout</span></span>
          <p className="sampark-login-tagline">Technology intelligence for Samsung — standalone development surface</p>
        </div>

        <div className="sampark-login-intro">
          <h1>Access TechScout</h1>
          <p>Sign in with your TechScout role key. Your browser’s private viewer profile (preferences, follows, personalization) remains separate from this privileged session.</p>
          <p className="sampark-login-sso-note"><Icon name="shield" size={14} /> Samsung Sampark SSO will be used in the integrated deployment — no second login will be needed.</p>
        </div>

        {isAuthed && <div className="sampark-login-status is-success" role="status"><Icon name="check" size={16} /> Already signed in — {capabilities.length} permission{capabilities.length===1?'':'s'} active. <NavLink to="/for-you">Continue to For You</NavLink></div>}

        <form className="sampark-login-form" onSubmit={handleSubmit} data-no-translate>
          <label className="sampark-login-field">
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} disabled={busy}>
              <option value="director">Director</option>
              <option value="gatekeeper">Gatekeeper</option>
              <option value="analytics">Analytics</option>
              <option value="editor">Editor</option>
            </select>
          </label>
          <label className="sampark-login-field">
            <span>Access key</span>
            <input type="password" autoComplete="current-password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Enter role key" disabled={busy} />
          </label>
          {error && <div className="sampark-login-error" role="alert">{error}</div>}
          {success && <div className="sampark-login-success" role="status">{success}</div>}
          <button className="btn-primary sampark-login-submit" disabled={busy || !key.trim()} type="submit">{busy ? 'Verifying…' : 'Continue — Sign In'}</button>
          <div className="sampark-login-help">
            <span>Network IP permissions apply automatically; a role key adds protected tools.</span>
            <NavLink to="/for-you">Skip — continue as viewer</NavLink>
          </div>
        </form>

        <div className="sampark-login-foot">
          <span>{capabilities.length} permission{capabilities.length===1?'':'s'} active</span>
          <span>Standalone mode — SSO not yet connected (TBD)</span>
        </div>
      </div>
    </div>
  );
}
