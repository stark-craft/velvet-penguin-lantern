import React, { useEffect, useState } from 'react';
import ArticleCard from '../components/ArticleCard.jsx';
import Icon from '../components/Icon.jsx';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import { getViewerSaved, removeSavedArticle } from '../api.js';
import { normalizeList } from '../utils/normalize.js';
import { articleKey } from '../utils/intelligence.js';

export default function SavedScreen() {
  const [items, setItems] = useState([]);
  const [openArticle, setOpenArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadSaved = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getViewerSaved();
      setItems(normalizeList(response?.items || []));
    } catch (requestError) {
      setError(requestError?.message || 'Could not load your saved signals.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSaved();
  }, []);

  const remove = async (item) => {
    const key = articleKey(item);
    try {
      await removeSavedArticle(item);
      setItems((current) => current.filter((entry) => articleKey(entry) !== key));
      if (openArticle && articleKey(openArticle) === key) setOpenArticle(null);
    } catch (requestError) {
      setError(requestError?.message || 'Could not remove this saved signal.');
    }
  };

  return (
    <div className="page-stack">
      <section className="page-hero">
        <div>
          <div className="eyebrow">Personal workspace / Saved for later</div>
          <h1>Your saved intelligence.</h1>
          <p>
            These signals belong only to your viewer identity and profile. Saving
            does not train the bouncer or change another person&apos;s feed.
          </p>
        </div>
        <button className="btn-dark-secondary" onClick={loadSaved} type="button">
          <Icon name="refresh" size={15} /> Refresh saved signals
        </button>
      </section>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="workflow-empty">
          <Icon name="refresh" size={24} />
          <h2>Loading your saved signals</h2>
        </div>
      ) : items.length === 0 ? (
        <div className="workflow-empty">
          <Icon name="bookmark" size={26} />
          <h2>Nothing saved yet</h2>
          <p>Use Save on any briefing card or inside its dossier. It will appear here after a refresh too.</p>
        </div>
      ) : (
        <>
          <div className="workflow-summary-grid">
            <div><strong>{items.length}</strong><span>Saved by you</span></div>
            <div><strong>Private</strong><span>Viewer and profile scoped</span></div>
            <div><strong>Persistent</strong><span>Survives refresh and restart</span></div>
          </div>
          <div className="home-article-grid grid gap-8">
            {items.map((item) => (
              <div key={articleKey(item)} className="flex min-h-0 flex-col gap-2">
                <ArticleCard item={item} onOpen={setOpenArticle} />
                <button
                  className="btn-dark-secondary w-full justify-center"
                  onClick={() => remove(item)}
                  type="button"
                >
                  <Icon name="trash" size={14} /> Remove from Saved
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <ArticleModal
        item={openArticle}
        onClose={() => setOpenArticle(null)}
        onSave={remove}
        isSaved
      />
    </div>
  );
}
