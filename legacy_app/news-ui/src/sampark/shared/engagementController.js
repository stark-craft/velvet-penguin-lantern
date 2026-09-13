import { computeActiveMs as helperComputeActiveMs, shouldEmitDwell as helperShouldEmitDwell, flushDwellOnClose as helperFlush } from './engagementHelper.js';

export class EngagementController {
  constructor({ now = () => Date.now(), send = async () => {}, isVisible = () => typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true, addListener = (fn) => typeof document !== 'undefined' && document.addEventListener('visibilitychange', fn), removeListener = (fn) => typeof document !== 'undefined' && document.removeEventListener('visibilitychange', fn), setInterval: setInt = (fn, ms) => setInterval(fn, ms), clearInterval: clrInt = (id) => clearInterval(id), surface = 'shared_briefing' } = {}) {
    this.now = now;
    this.send = send;
    this.isVisible = isVisible;
    this.addListener = addListener;
    this.removeListener = removeListener;
    this.setInterval = setInt;
    this.clearInterval = clrInt;
    this.surface = surface;
    this.state = { start: 0, total: 0, visible: this.isVisible(), sentOpen: false, sentDwell: false, sentSource: false, articleId: '' };
    this.currentArticle = null;
    this.isOpen = false;
    this.intervalId = null;
    this.boundVisibility = this.handleVisibility.bind(this);
    this.mounted = true;
    this.attached = false;
    this.destroyed = false;
    this.listenerRegistered = false;
  }

  _articleId(article) {
    return article?.article_id || article?.id || article?.canonical_link || article?.link || article?.url || article?.title || '';
  }

  _computeActiveMs() {
    const s = this.state;
    try {
      if (helperComputeActiveMs) return helperComputeActiveMs(s.total, s.start, s.visible, this.now());
    } catch {}
    if (s.visible && s.start) return s.total + (this.now() - s.start);
    return s.total;
  }

  async _send(action, detail, activeMs = 0) {
    try {
      const target = detail || this.currentArticle;
      const targetId = this._articleId(target) || this.state.articleId;
      await this.send(action, { ...target, article_id: targetId, surface: this.surface, active_ms: activeMs, visible_ratio: 1 });
    } catch {}
  }

  handleVisibility() {
    const s = this.state;
    if (!this.isVisible()) {
      if (s.visible && s.start != null) {
        s.total += this.now() - s.start;
        s.visible = false;
      }
    } else {
      if (!s.visible) {
        s.start = this.now();
        s.visible = true;
      }
    }
  }

  _startInterval() {
    if (this.intervalId) return;
    if (!this.attached) return;
    if (!this.listenerRegistered) {
      this.addListener(this.boundVisibility);
      this.listenerRegistered = true;
    }
    this.intervalId = this.setInterval(() => {
      const s = this.state;
      if (helperShouldEmitDwell) {
        if (!helperShouldEmitDwell(s.total, s.start, s.visible, s.sentDwell, s.sentOpen, this.now())) return;
      } else if (!s.visible || s.sentDwell || !s.sentOpen) return;
      const active = this._computeActiveMs();
      if (active >= 5000) {
        s.sentDwell = true;
        this._send('dossier_dwell', this.currentArticle, active);
      }
    }, 1000);
  }

  _stopInterval() {
    if (this.intervalId) {
      this.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.listenerRegistered) {
      this.removeListener(this.boundVisibility);
      this.listenerRegistered = false;
    }
  }

  attach() {
    if (this.destroyed) return;
    if (this.attached) return;
    this.attached = true;
    this.mounted = true;
    if (!this.listenerRegistered) {
      this.addListener(this.boundVisibility);
      this.listenerRegistered = true;
    }
    if (this.isOpen && !this.state.sentDwell) {
      if (!this.state.visible) {
        this.state.visible = this.isVisible();
        if (this.state.visible) this.state.start = this.now();
      } else if (this.state.start == null) {
        this.state.start = this.now();
      }
      if (this.state.visible && !this.intervalId) {
        this._startInterval();
      }
    }
  }

  detach() {
    if (this.destroyed) return;
    if (!this.attached) return;
    // Accumulate current visible segment
    if (this.state.visible && this.state.start != null) {
      this.state.total += this.now() - this.state.start;
      this.state.start = 0;
      this.state.visible = false;
    }
    // Emit qualifying dwell once if threshold already reached
    if (this.state.sentOpen && !this.state.sentDwell && this.state.total >= 5000) {
      this.state.sentDwell = true;
      this._send('dossier_dwell', this.currentArticle, this.state.total);
    }
    this._stopInterval();
    this.attached = false;
    // Do not permanently poison; preserve logical open state for immediate re-attach
    // isOpen remains as is, so attach can resume
  }

  // Called when article prop changes (including replacement A->B)
  setArticle(newArticle) {
    const newId = this._articleId(newArticle);
    if (this.state.articleId === newId) {
      // Same article, just update reference but preserve state
      this.currentArticle = newArticle;
      return;
    }
    // Different article: flush previous if needed before switching
    if (this.state.sentOpen && !this.state.sentDwell) {
      const active = this._computeActiveMs();
      if (active >= 5000) {
        this.state.sentDwell = true;
        this._send('dossier_dwell', this.currentArticle, active);
      } else if (this.state.visible && this.state.start != null) {
        // accumulate final segment even if not emitting, to avoid carrying over
        this.state.total += this.now() - this.state.start;
      }
    }
    // If was open, close it without emitting if below threshold (already handled above)
    // Reset for new article but do not auto-open
    this._stopInterval();
    this.isOpen = false;
    this.state = { start: 0, total: 0, visible: this.isVisible(), sentOpen: false, sentDwell: false, sentSource: false, articleId: newId };
    this.currentArticle = newArticle;
  }

  onDossierOpen(article) {
    if (this.destroyed) return;
    const id = this._articleId(article);
    if (!id || this.state.sentOpen) {
      // If already sentOpen for this article, ignore duplicate open
      if (this.state.articleId === id && this.state.sentOpen) return;
    }
    // If article changed without setArticle being called, handle flush
    if (this.state.articleId !== id) {
      this.setArticle(article);
    }
    if (!id || this.state.sentOpen) return;
    this.currentArticle = article;
    this.state.sentOpen = true;
    this.state.start = this.now();
    this.state.total = 0;
    this.state.visible = this.isVisible();
    this.state.articleId = id;
    this.isOpen = true;
    this._send('dossier_open', article, 0);
    this._startInterval();
  }

  onSourceOpen(article) {
    if (this.destroyed) return;
    const id = this._articleId(article) || this.state.articleId;
    if (!id || this.state.sentSource) return;
    // Ensure article matches current or use passed
    const target = article || this.currentArticle;
    this.state.sentSource = true;
    this._send('source_open', target, 0);
  }

  onDossierClose() {
    if (this.destroyed) {
      // Final disposal already ran; ensure closed without duplicate emit.
      this.isOpen = false;
      return;
    }
    const res = helperFlush ? helperFlush({ total: this.state.total, start: this.state.start, visible: this.state.visible, sentOpen: this.state.sentOpen, sentDwell: this.state.sentDwell }, this.now()) : null;
    if (res) {
      this.state.total = res.total;
      this.state.start = res.start;
      this.state.visible = res.visible;
      if (res.shouldEmit) {
        this.state.sentDwell = true;
        this._send('dossier_dwell', this.currentArticle, res.activeMs);
      }
    } else {
      if (this.state.visible && this.state.start != null) {
        this.state.total += this.now() - this.state.start;
        this.state.start = 0;
        this.state.visible = false;
      }
      const active = this.state.total;
      if (this.state.sentOpen && !this.state.sentDwell && active >= 5000) {
        this.state.sentDwell = true;
        this._send('dossier_dwell', this.currentArticle, active);
      }
    }
    this.isOpen = false;
    this._stopInterval();
  }

  // Hook owns unmount cleanup; do not call setState after unmount
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.mounted = false;
    this.attached = false;
    // Flush once if needed (without setState)
    if (this.state.sentOpen && !this.state.sentDwell) {
      const active = this._computeActiveMs();
      if (active >= 5000) {
        this.state.sentDwell = true;
        this._send('dossier_dwell', this.currentArticle, active);
      }
    }
    this._stopInterval();
    this.isOpen = false;
  }

  getActiveMs() {
    return this._computeActiveMs();
  }
}
