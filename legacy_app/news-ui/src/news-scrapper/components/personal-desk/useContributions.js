import { useEffect, useRef, useState } from 'react';
import { getMyContributions } from '../../api.js';

export const CONTRIBUTIONS_CHANGED_EVENT = 'sense-internal-contributions-change';

// Mutations elsewhere in the Contribute flow dispatch this so every mounted
// hook instance (desk header counts, workspace list) reloads together.
export function notifyContributionsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CONTRIBUTIONS_CHANGED_EVENT));
  }
}

// Shared contribution index backed by the internal-content API. The backend is
// authoritative; this hook never caches beyond the current render cycle.
export default function useContributions() {
  const [contributions, setContributions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const refresh = () => {
      getMyContributions().then((records) => {
        if (!alive.current) return;
        setContributions(records);
        setError('');
        setLoaded(true);
      }).catch((requestError) => {
        if (!alive.current) return;
        setError(requestError?.message || 'Could not load your contributions.');
        setLoaded(true);
      });
    };
    refresh();
    const handleChange = () => refresh();
    window.addEventListener(CONTRIBUTIONS_CHANGED_EVENT, handleChange);
    return () => {
      alive.current = false;
      window.removeEventListener(CONTRIBUTIONS_CHANGED_EVENT, handleChange);
    };
  }, []);

  return { contributions, loaded, error };
}
