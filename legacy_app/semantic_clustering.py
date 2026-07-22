import sys
sys.stdout.reconfigure(encoding='utf-8')

import json
import os
import re
import threading
from datetime import datetime
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse
import numpy as np

try:
    from sentence_transformers import SentenceTransformer
    from sklearn.cluster import AgglomerativeClustering
    CLUSTERING_AVAILABLE = True
except ImportError as e:
    print(f"FUSION ERROR: Missing AI libraries: {e}")
    print("Run: pip install sentence-transformers scikit-learn")
    CLUSTERING_AVAILABLE = False

try:
    from transformers import pipeline
    SENTIMENT_AVAILABLE = True
except ImportError:
    SENTIMENT_AVAILABLE = False

try:
    from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
    BART_AVAILABLE = True
except ImportError:
    BART_AVAILABLE = False

BASE_DIR = Path(__file__).resolve().parent
SEMANTIC_MODEL_DIR = BASE_DIR / "semantic_model"
FALLBACK_MINILM_DIR = BASE_DIR / "local_miniLM_model"
BART_MODEL_DIR = BASE_DIR / "local_bart_model"
SEEN_REGISTRY_FILE = BASE_DIR / "seen_registry.json"
DEFAULT_CLUSTER_DISTANCE_THRESHOLD = 0.32
MAX_CLUSTER_TEXT_CHARS = 2200
SEEN_REGISTRY_LOCK = threading.Lock()
SUMMARY_MODEL_LOCK = threading.Lock()
SUMMARY_INFERENCE_LOCK = threading.Lock()
SHARED_BART_TOKENIZER = None
SHARED_BART_MODEL = None

# Offline proof switch.
# When SENSE_OFFLINE_ONLY=1, this module must use only local model folders.
# That prevents accidental fallback downloads during security demonstrations.
OFFLINE_ONLY = os.environ.get("SENSE_OFFLINE_ONLY") == "1"


def load_seen_registry():
    with SEEN_REGISTRY_LOCK:
        if not SEEN_REGISTRY_FILE.exists():
            return {}
        try:
            with open(SEEN_REGISTRY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}


def merge_seen_registry(seen_registry):
    with SEEN_REGISTRY_LOCK:
        current = {}
        if SEEN_REGISTRY_FILE.exists():
            try:
                with open(SEEN_REGISTRY_FILE, "r", encoding="utf-8") as f:
                    current = json.load(f)
            except Exception:
                current = {}
        current.update(seen_registry)
        with open(SEEN_REGISTRY_FILE, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=4)


class MinimalSemanticEngine:
    def __init__(self, load_summarizer=False):
        self.semantic_model = None
        self.sentiment_analyzer = None
        self.bart_model = None
        self.bart_tokenizer = None
        self.load_models(load_summarizer=load_summarizer)

    def load_models(self, load_summarizer=False):
        if CLUSTERING_AVAILABLE:
            try:
                print("FUSION ENGINE: Loading Semantic Model...", flush=True)
                if SEMANTIC_MODEL_DIR.exists():
                    self.semantic_model = SentenceTransformer(str(SEMANTIC_MODEL_DIR))
                    print("FUSION ENGINE: Semantic Model Ready.", flush=True)
                elif FALLBACK_MINILM_DIR.exists():
                    self.semantic_model = SentenceTransformer(str(FALLBACK_MINILM_DIR))
                    print("FUSION ENGINE: Semantic Model Ready.", flush=True)
                elif OFFLINE_ONLY:
                    # In offline proof mode we intentionally do not call
                    # SentenceTransformer("all-MiniLM-L6-v2"), because that name
                    # can trigger a Hugging Face Hub lookup if the model is not
                    # already cached. Local folder or nothing.
                    print(
                        "FUSION ENGINE: Offline-only mode and no local semantic model found.",
                        flush=True,
                    )
                else:
                    # Normal production fallback. This is convenient for setup,
                    # but not used in the offline proof harness.
                    print("FUSION ENGINE: Local semantic model not found.", flush=True)
                    print("FUSION ENGINE: Attempting generic download...", flush=True)
                    self.semantic_model = SentenceTransformer("all-MiniLM-L6-v2")
            except Exception as e:
                print(f"FUSION ENGINE: Semantic load failed ({e})", flush=True)

        if SENTIMENT_AVAILABLE and not OFFLINE_ONLY:
            # The sentiment pipeline is optional metadata. It currently uses a
            # model name rather than a project-local model folder, so we skip it
            # during offline proof runs. Clustering and BART summarization still
            # run locally.
            try:
                print("FUSION ENGINE: Loading Sentiment Analyzer...", flush=True)
                self.sentiment_analyzer = pipeline(
                    "sentiment-analysis",
                    model="distilbert-base-uncased-finetuned-sst-2-english",
                    device=-1,
                )
            except Exception as e:
                print(f"FUSION ENGINE: Sentiment load failed ({e})", flush=True)
        elif OFFLINE_ONLY:
            print("FUSION ENGINE: Offline-only mode; sentiment analyzer skipped.", flush=True)

        if load_summarizer:
            self.load_bart_model()

    def load_bart_model(self):
        global SHARED_BART_MODEL, SHARED_BART_TOKENIZER

        if self.bart_model and self.bart_tokenizer:
            return
        if not BART_AVAILABLE or not BART_MODEL_DIR.exists():
            return

        with SUMMARY_MODEL_LOCK:
            try:
                if SHARED_BART_MODEL is None or SHARED_BART_TOKENIZER is None:
                    print("FUSION ENGINE: Loading shared summarization model...", flush=True)
                    # local_files_only=True is the key safety setting here:
                    # Transformers must load tokenizer/config/weights from
                    # BART_MODEL_DIR and cannot fetch missing files from the hub.
                    SHARED_BART_TOKENIZER = AutoTokenizer.from_pretrained(
                        str(BART_MODEL_DIR), local_files_only=True
                    )
                    SHARED_BART_MODEL = AutoModelForSeq2SeqLM.from_pretrained(
                        str(BART_MODEL_DIR), local_files_only=True
                    )
                    print("FUSION ENGINE: Shared summarization ready.", flush=True)
                self.bart_tokenizer = SHARED_BART_TOKENIZER
                self.bart_model = SHARED_BART_MODEL
            except Exception as e:
                print(f"FUSION ENGINE: BART load failed ({e})", flush=True)

    def safe_text(self, value):
        return re.sub(r"\s+", " ", str(value or "")).strip()

    def clean_content_text(self, text):
        text = self.safe_text(text)
        for pattern in [
            r"(?i)\badvertisement\b",
            r"(?i)\bsponsored\b",
            r"(?i)\bsubscribe now\b",
            r"(?i)\bsign up\b",
            r"(?i)\bnewsletter\b",
            r"(?i)\bread more\b",
            r"(?i)\bclick here\b",
            r"(?i)\bfollow us\b",
            r"(?i)\ball rights reserved\b",
            r"(?i)\bshare this article\b",
            r"(?i)\baccept cookies\b",
            r"(?i)\bcookie policy\b",
            r"(?i)\bprivacy policy\b",
            r"(?i)\bterms of use\b",
        ]:
            text = re.sub(pattern, " ", text)
        text = re.sub(r"https?://\S+", " ", text)
        return re.sub(r"\s+", " ", text).strip()

    def get_article_content(self, article):
        return (
            self.safe_text(article.get("full_content"))
            or self.safe_text(article.get("full_contents"))
            or self.safe_text(article.get("summary"))
            or self.safe_text(article.get("snippet"))
            or self.safe_text(article.get("master_summary"))
        )

    def clean_summary(self, text):
        text = self.clean_content_text(text)
        if not text or len(text.strip()) < 20:
            return "No summary available."
        sentences = [
            s.strip()
            for s in re.split(r'(?<=[.!?])\s+', text)
            if s.strip()
        ]
        seen = set()
        unique = []
        for s in sentences:
            normalized = s.lower().strip()
            if normalized not in seen and len(s) > 25:
                seen.add(normalized)
                unique.append(s)
        result = ' '.join(unique[:3])
        if result and result[-1] not in '.!?':
            result += '.'
        if not result or len(result) < 20:
            return text[:300].strip() + '.'
        return result

    def generate_ppt_summary(self, text_list):
        combined_text = " ".join(text_list)
        self.load_bart_model()
        if not self.bart_model or len(combined_text) < 200:
            return self.clean_summary(combined_text)
        try:
            inputs = self.bart_tokenizer(
                [combined_text], max_length=1024,
                return_tensors="pt", truncation=True
            )
            with SUMMARY_INFERENCE_LOCK:
                summary_ids = self.bart_model.generate(
                    inputs["input_ids"],
                    num_beams=2, min_length=60, max_length=200, early_stopping=True,
                    length_penalty=2.0, no_repeat_ngram_size=3,
                )
            return self.bart_tokenizer.decode(summary_ids[0], skip_special_tokens=True)
        except:
            return self.clean_summary(combined_text)

    def generate_dynamic_summary(self, text_list):
        combined_text = " ".join(text_list)
        word_count = len(combined_text.split())
        self.load_bart_model()
        if not self.bart_model or word_count < 40:
            return self.clean_summary(combined_text)
        if word_count < 150: min_len, max_len = 40, 100
        elif word_count < 500: min_len, max_len = 80, 250
        else: min_len, max_len = 150, 400
        try:
            inputs = self.bart_tokenizer(
                [combined_text], max_length=1024,
                return_tensors="pt", truncation=True
            )
            with SUMMARY_INFERENCE_LOCK:
                summary_ids = self.bart_model.generate(
                    inputs["input_ids"],
                    num_beams=4, min_length=min_len, max_length=max_len, early_stopping=True,
                    length_penalty=2.0, no_repeat_ngram_size=3,
                )
            return self.bart_tokenizer.decode(summary_ids[0], skip_special_tokens=True)
        except Exception as e:
            print(f"FUSION ENGINE: Dynamic Summary Error ({e})", flush=True)
            return self.clean_summary(combined_text)

    def get_sentiment(self, text):
        if not self.sentiment_analyzer:
            return "neutral"
        try:
            result = self.sentiment_analyzer(text[:512])[0]
            label = result["label"].lower()
            score = result["score"]
            if label == "positive" and score > 0.6: return "positive"
            elif label == "negative" and score > 0.6: return "negative"
            else: return "neutral"
        except:
            return "neutral"

    def extract_entities_simple(self, text):
        words = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b", text)
        ignore = {"The", "A", "An", "But", "Or", "For", "In", "On", "At", "To", "From", "With", "By", "This", "That"}
        entities = [w for w in words if w not in ignore and len(w) > 2]
        top = [e for e, _ in Counter(entities).most_common(10)]
        return {"people": top[:5], "organizations": [], "locations": []}

    def calculate_importance_score(self, cluster, all_articles):
        source_count = len(cluster)
        total_articles = len(all_articles) if len(all_articles) > 0 else 1
        source_score = min(1.0, (source_count / total_articles) * 10)
        unique_sources = len(set(art.get("source", "Unknown") for art in cluster))
        diversity_score = min(1.0, unique_sources / 3)
        try:
            dates = []
            for art in cluster:
                d_str = art.get("date", "")
                if d_str:
                    try: dates.append(datetime.strptime(d_str, "%Y-%m-%d"))
                    except: pass
            if dates:
                days_old = (datetime.now() - max(dates)).days
                recency_score = max(0, 1.0 - (days_old * 0.1))
            else:
                recency_score = 0.5
        except:
            recency_score = 0.5
        final_score = (source_score * 50) + (diversity_score * 30) + (recency_score * 20)
        return round(final_score, 0)

    def build_cluster_text(self, article):
        keywords = article.get("keywords_found", [])
        if isinstance(keywords, list):
            keywords = ", ".join(str(keyword) for keyword in keywords)
        return self.clean_content_text(
            f"Title: {article.get('title', '')} "
            f"Keywords: {keywords} Content: {self.get_article_content(article)[:MAX_CLUSTER_TEXT_CHARS]}"
        )

    def semantic_cluster(self, articles, distance_threshold=DEFAULT_CLUSTER_DISTANCE_THRESHOLD):
        if not self.semantic_model or not CLUSTERING_AVAILABLE or len(articles) < 2:
            print(f"FUSION WARNING: Clustering skipped. Model loaded: {self.semantic_model is not None}", flush=True)
            return [[art] for art in articles]
        try:
            print(f"FUSION ENGINE: Computing embeddings for {len(articles)} articles...", flush=True)
            texts = [self.build_cluster_text(art) for art in articles]

            if len(texts) > 50:
                batch_size = 32
                all_embeddings = []
                for i in range(0, len(texts), batch_size):
                    batch = texts[i:i + batch_size]
                    batch_emb = self.semantic_model.encode(batch, show_progress_bar=False)
                    all_embeddings.append(batch_emb)
                    done = min(i + batch_size, len(texts))
                    print(f"FUSION ENGINE: Embedding articles... {done}/{len(texts)}", flush=True)
                embeddings = np.vstack(all_embeddings)
            else:
                embeddings = self.semantic_model.encode(texts, show_progress_bar=False)

            embeddings = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)
            try:
                clusterer = AgglomerativeClustering(
                    n_clusters=None, metric="cosine", linkage="average",
                    distance_threshold=distance_threshold,
                )
            except TypeError:
                clusterer = AgglomerativeClustering(
                    n_clusters=None, affinity="cosine", linkage="average",
                    distance_threshold=distance_threshold,
                )
            labels = clusterer.fit_predict(embeddings)
            clusters = {}
            for idx, label in enumerate(labels):
                if label not in clusters: clusters[label] = []
                clusters[label].append(idx)
            diverse_clusters = self.enforce_source_diversity(
                list(clusters.values()),
                articles,
                embeddings,
            )
            print(f"FUSION ENGINE: Condensed {len(articles)} articles into {len(diverse_clusters)} events. (cosine distance threshold={distance_threshold}; unique-source guard enabled)", flush=True)
            return [
                [articles[index] for index in cluster]
                for cluster in diverse_clusters
            ]
        except Exception as e:
            print(f"FUSION ENGINE: Clustering Error ({e})", flush=True)
            return [[art] for art in articles]

    @staticmethod
    def source_identity(article):
        """Return a stable publisher identity for clustering safeguards."""

        source = " ".join(str(article.get("source") or "").lower().split())
        if source and source != "unknown":
            return source
        hostname = urlparse(str(article.get("link") or "")).hostname or ""
        return hostname.lower().removeprefix("www.") or str(article.get("link") or "unknown")

    def enforce_source_diversity(self, clusters, articles, embeddings):
        """Split semantic groups so one publisher appears at most once per event.

        Multiple reports from different publishers are corroboration. Multiple
        pages from one publisher are usually separate stories or updates and
        must not inflate source_count. Within an initial semantic group, this
        method greedily pairs each article with the most similar eligible group
        that does not already contain its publisher.
        """

        output = []
        for cluster in clusters:
            partitions = []
            for article_index in cluster:
                identity = self.source_identity(articles[article_index])
                eligible = [
                    partition
                    for partition in partitions
                    if identity not in partition["sources"]
                ]
                if eligible:
                    chosen = max(
                        eligible,
                        key=lambda partition: float(np.mean([
                            np.dot(embeddings[article_index], embeddings[member])
                            for member in partition["members"]
                        ])),
                    )
                else:
                    chosen = {"members": [], "sources": set()}
                    partitions.append(chosen)
                chosen["members"].append(article_index)
                chosen["sources"].add(identity)
            output.extend(partition["members"] for partition in partitions)
        return output

    def _build_event(
        self,
        article,
        all_articles,
        seen_registry,
        current_run_time,
        fast_mode,
        force_lightweight_summary=False,
        event_idx=None,
        total=None,
    ):
        prefix = ""
        if event_idx is not None and total is not None:
            prefix = f"[{event_idx}/{total}] "
        title_preview = article.get("title", "Untitled")[:60]
        content = self.clean_content_text(self.get_article_content(article))
        summaries = [content[:1500]]
        full_contents = (
            article.get("full_content", "")
            or article.get("summary", "")
            or article.get("snippet", "")
        )
        main_link = article.get("link", "#")
        is_fresh = True
        first_seen_label = current_run_time
        if main_link != "#" and main_link in seen_registry:
            is_fresh = False
            first_seen_label = seen_registry[main_link]
        elif main_link != "#":
            seen_registry[main_link] = current_run_time

        if fast_mode or force_lightweight_summary:
            combined = " ".join([s for s in summaries if s.strip()])
            dynamic_summary = self.clean_summary(combined)
            ppt_summary = dynamic_summary
            print(f"FUSION ENGINE: {prefix}[LIGHT] Prepared: {title_preview}", flush=True)
        else:
            print(f"FUSION ENGINE: {prefix}BART summarizing: {title_preview}...", flush=True)
            ppt_summary = self.generate_ppt_summary(summaries)
            dynamic_summary = self.generate_dynamic_summary(summaries)

        if not dynamic_summary or len(dynamic_summary.strip()) < 10:
            dynamic_summary = article.get("snippet", "") or article.get("summary", "") or "No summary available."
        if not ppt_summary or len(ppt_summary.strip()) < 10:
            ppt_summary = dynamic_summary

        sentiment = self.get_sentiment(dynamic_summary)
        entities = self.extract_entities_simple(article.get("title", ""))
        importance = self.calculate_importance_score([article], all_articles)
        sources_list = [{
            "name": article.get("source", "Unknown"),
            "link": article.get("link", "#"),
            "date": article.get("date", ""),
        }]
        return {
            "title": article.get("title", "Untitled"),
            "master_summary": dynamic_summary,
            "ppt_summary": ppt_summary,
            "top_image": article.get("top_image", ""),
            "date": article.get("date", ""),
            "source_count": 1,
            "sources": sources_list,
            "link": main_link,
            "source": article.get("source", "Unknown"),
            "sentiment": sentiment,
            "importance_score": importance,
            "entities": entities,
            "keywords_found": article.get("keywords_found", []),
            "full_contents": full_contents,
            "is_fresh": is_fresh,
            "first_seen": first_seen_label,
        }

    def fuse_stream(self, job_id=None, fast_mode=False):
        if job_id:
            input_file = str(BASE_DIR / f"ui_results_{job_id}.json")
        else:
            input_file = str(BASE_DIR / "ui_results.json")
        mode_label = "FAST" if fast_mode else "LIGHT STREAM"
        print(f"FUSION ENGINE: [STREAM] Mode -> {mode_label}", flush=True)

        if not os.path.exists(input_file):
            print(f"FUSION ENGINE: Input file not found: {input_file}", flush=True)
            return

        with open(input_file, "r", encoding="utf-8") as f:
            raw_articles = json.load(f)

        if not raw_articles:
            return

        seen_registry = load_seen_registry()

        current_run_time = datetime.now().strftime("%Y-%m-%d %I:%M %p")
        total = len(raw_articles)
        print(f"FUSION ENGINE: [STREAM] Streaming {total} articles one by one...", flush=True)

        for idx, article in enumerate(raw_articles, 1):
            try:
                event = self._build_event(
                    article, raw_articles, seen_registry,
                    current_run_time, fast_mode,
                    force_lightweight_summary=True,
                    event_idx=idx, total=total,
                )
                print(f"FUSION ENGINE: [{idx}/{total}] ✓ Streamed: {article.get('title', '')[:50]}", flush=True)
                yield event
            except Exception as e:
                print(f"FUSION ENGINE: [{idx}/{total}] ✗ Error: {e}", flush=True)
                continue

        merge_seen_registry(seen_registry)
        print(f"FUSION ENGINE: [STREAM] All {total} articles streamed.", flush=True)

    def fuse_cluster(self, job_id=None, fast_mode=False):
        if job_id:
            input_file = str(BASE_DIR / f"ui_results_{job_id}.json")
            output_file = str(BASE_DIR / f"clustered_results_{job_id}.json")
        else:
            input_file = str(BASE_DIR / "ui_results.json")
            output_file = str(BASE_DIR / "clustered_results.json")
        print(f"FUSION ENGINE: [CLUSTER] Starting re-cluster...", flush=True)

        if not os.path.exists(input_file):
            print(f"FUSION ENGINE: [CLUSTER] Input not found.", flush=True)
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump([], f)
            return

        with open(input_file, "r", encoding="utf-8") as f:
            raw_articles = json.load(f)

        if not raw_articles:
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump([], f)
            return

        seen_registry = load_seen_registry()

        current_run_time = datetime.now().strftime("%Y-%m-%d %I:%M %p")
        clusters = self.semantic_cluster(raw_articles)
        final_output = []
        total_events = len(clusters)

        for event_idx, cluster in enumerate(clusters, 1):
            title_preview = cluster[0].get("title", "Untitled")[:60]
            sources_in_cluster = len(cluster)
            print(
                f"FUSION ENGINE: [CLUSTER] [{event_idx}/{total_events}] "
                f"Merging: {title_preview}... ({sources_in_cluster} source{'s' if sources_in_cluster > 1 else ''})",
                flush=True,
            )

            main_art = cluster[0]
            for art in cluster:
                if art.get("top_image"):
                    main_art = art
                    break

            main_link = main_art.get("link", "#")
            is_fresh = True
            first_seen_label = current_run_time
            if main_link != "#" and main_link in seen_registry:
                is_fresh = False
                first_seen_label = seen_registry[main_link]
            elif main_link != "#":
                seen_registry[main_link] = current_run_time

            summaries = []
            for art in cluster:
                content = self.clean_content_text(self.get_article_content(art))
                summaries.append(content[:1500])

            full_contents = " ".join(
                self.clean_content_text(self.get_article_content(art)) for art in cluster
            )

            if fast_mode:
                # Fast mode is used for scheduler/performance-sensitive paths.
                # It avoids BART and creates an extractive summary from the
                # already collected article text.
                combined = " ".join([s for s in summaries if s.strip()])
                dynamic_summary = self.clean_summary(combined)
                ppt_summary = dynamic_summary
            else:
                # Deep mode proves/uses the local BART summarizer. The offline
                # proof runner intentionally uses this branch by default.
                ppt_summary = self.generate_ppt_summary(summaries)
                dynamic_summary = self.generate_dynamic_summary(summaries)

            if not dynamic_summary or len(dynamic_summary.strip()) < 10:
                dynamic_summary = main_art.get("snippet", "") or main_art.get("summary", "") or "No summary available."
            if not ppt_summary or len(ppt_summary.strip()) < 10:
                ppt_summary = dynamic_summary

            sentiment = self.get_sentiment(dynamic_summary)
            all_text = " ".join([art.get("title", "") for art in cluster])
            entities = self.extract_entities_simple(all_text)
            importance = self.calculate_importance_score(cluster, raw_articles)

            sources_list = []
            for art in cluster:
                sources_list.append({
                    "name": art.get("source", "Unknown"),
                    "link": art.get("link", "#"),
                    "date": art.get("date", ""),
                })

            final_output.append({
                "title": main_art.get("title", "Untitled"),
                "master_summary": dynamic_summary,
                "ppt_summary": ppt_summary,
                "top_image": main_art.get("top_image", ""),
                "date": main_art.get("date", ""),
                "source_count": len(cluster),
                "sources": sources_list,
                "link": main_link,
                "source": main_art.get("source", "Unknown"),
                "sentiment": sentiment,
                "importance_score": importance,
                "entities": entities,
                "keywords_found": main_art.get("keywords_found", []),
                "full_contents": full_contents,
                "is_fresh": is_fresh,
                "first_seen": first_seen_label,
            })

            bar_len = 30
            filled = int(bar_len * event_idx / total_events)
            bar = "█" * filled + "░" * (bar_len - filled)
            pct = int(100 * event_idx / total_events)
            print(f"FUSION ENGINE: [{bar}] {pct}% — {event_idx}/{total_events} events fused", flush=True)

        final_output.sort(key=lambda x: x["importance_score"], reverse=True)

        print(f"FUSION ENGINE: [CLUSTER] Saving {len(final_output)} clustered events.", flush=True)

        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(final_output, f, indent=4, ensure_ascii=False)
        merge_seen_registry(seen_registry)

        print(
            f"FUSION ENGINE: [CLUSTER] Complete. "
            f"{len(raw_articles)} articles → {len(final_output)} events. "
            f"Output -> {os.path.basename(output_file)}",
            flush=True,
        )

    def fuse(self, job_id=None, fast_mode=False):
        if job_id:
            input_file = str(BASE_DIR / f"ui_results_{job_id}.json")
            output_file = str(BASE_DIR / f"clustered_results_{job_id}.json")
        else:
            input_file = str(BASE_DIR / "ui_results.json")
            output_file = str(BASE_DIR / "clustered_results.json")
        mode_label = "FAST (no BART)" if fast_mode else "DEEP (BART enabled)"
        print(f"FUSION ENGINE: Mode -> {mode_label}", flush=True)
        print(f"FUSION ENGINE: Input -> {os.path.basename(input_file)}", flush=True)
        print(f"FUSION ENGINE: Output -> {os.path.basename(output_file)}", flush=True)

        if not os.path.exists(input_file):
            print(f"FUSION ENGINE: Input file not found: {input_file}", flush=True)
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump([], f)
            return

        with open(input_file, "r", encoding="utf-8") as f:
            raw_articles = json.load(f)

        if not raw_articles:
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump([], f)
            return

        seen_registry = load_seen_registry()

        current_run_time = datetime.now().strftime("%Y-%m-%d %I:%M %p")
        print(f"FUSION ENGINE: Processing {len(raw_articles)} raw articles...", flush=True)

        clusters = self.semantic_cluster(raw_articles)
        final_output = []
        total_events = len(clusters)

        for event_idx, cluster in enumerate(clusters, 1):
            sources_in_cluster = len(cluster)
            title_preview = cluster[0].get("title", "Untitled")[:60]
            print(
                f"FUSION ENGINE: [{event_idx}/{total_events}] "
                f"Processing: {title_preview}... "
                f"({sources_in_cluster} source{'s' if sources_in_cluster > 1 else ''})",
                flush=True,
            )

            main_art = cluster[0]
            for art in cluster:
                if art.get("top_image"):
                    main_art = art
                    break

            main_link = main_art.get("link", "#")
            is_fresh = True
            first_seen_label = current_run_time
            if main_link != "#" and main_link in seen_registry:
                is_fresh = False
                first_seen_label = seen_registry[main_link]
            elif main_link != "#":
                seen_registry[main_link] = current_run_time

            summaries = []
            for art in cluster:
                content = self.clean_content_text(self.get_article_content(art))
                summaries.append(content[:1500])

            full_contents = " ".join(
                self.clean_content_text(self.get_article_content(art)) for art in cluster
            )

            if fast_mode:
                # Batch fast mode mirrors scheduler behavior: no BART call,
                # only deterministic lightweight summary cleanup.
                combined = " ".join([s for s in summaries if s.strip()])
                dynamic_summary = self.clean_summary(combined)
                ppt_summary = dynamic_summary
                print(f"FUSION ENGINE: [{event_idx}/{total_events}] [FAST] Cleaned: {main_art.get('title', '')[:50]}", flush=True)
            else:
                # Batch deep mode runs the local BART model from
                # local_bart_model/. This is also what the offline proof uses
                # when --skip-bart is not supplied.
                print(f"FUSION ENGINE: [{event_idx}/{total_events}] BART summarizing: {title_preview[:50]}...", flush=True)
                ppt_summary = self.generate_ppt_summary(summaries)
                dynamic_summary = self.generate_dynamic_summary(summaries)

            if not dynamic_summary or len(dynamic_summary.strip()) < 10:
                dynamic_summary = main_art.get("snippet", "") or main_art.get("summary", "") or "No summary available."
            if not ppt_summary or len(ppt_summary.strip()) < 10:
                ppt_summary = dynamic_summary

            sentiment = self.get_sentiment(dynamic_summary)
            all_text = " ".join([art.get("title", "") for art in cluster])
            entities = self.extract_entities_simple(all_text)
            importance = self.calculate_importance_score(cluster, raw_articles)

            sources_list = []
            for art in cluster:
                sources_list.append({
                    "name": art.get("source", "Unknown"),
                    "link": art.get("link", "#"),
                    "date": art.get("date", ""),
                })

            final_output.append({
                "title": main_art.get("title", "Untitled"),
                "master_summary": dynamic_summary,
                "ppt_summary": ppt_summary,
                "top_image": main_art.get("top_image", ""),
                "date": main_art.get("date", ""),
                "source_count": len(cluster),
                "sources": sources_list,
                "link": main_link,
                "source": main_art.get("source", "Unknown"),
                "sentiment": sentiment,
                "importance_score": importance,
                "entities": entities,
                "keywords_found": main_art.get("keywords_found", []),
                "full_contents": full_contents,
                "is_fresh": is_fresh,
                "first_seen": first_seen_label,
            })

            bar_len = 30
            filled = int(bar_len * event_idx / total_events)
            bar = "█" * filled + "░" * (bar_len - filled)
            pct = int(100 * event_idx / total_events)
            print(f"FUSION ENGINE: [{bar}] {pct}% — {event_idx}/{total_events} events fused", flush=True)

        final_output.sort(key=lambda x: x["importance_score"], reverse=True)
        print(f"FUSION ENGINE: Saving {len(final_output)} final events.", flush=True)

        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(final_output, f, indent=4, ensure_ascii=False)
        merge_seen_registry(seen_registry)

        print(f"FUSION ENGINE: Complete. Output -> {os.path.basename(output_file)}", flush=True)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", default=None)
    parser.add_argument("--fast-mode", action="store_true", default=False)
    parser.add_argument(
        "--mode",
        choices=["batch", "stream", "cluster"],
        default="batch",
    )
    args = parser.parse_args()
    engine = MinimalSemanticEngine()
    if args.mode == "stream":
        for event in engine.fuse_stream(job_id=args.job_id, fast_mode=args.fast_mode):
            print(json.dumps(event, ensure_ascii=False), flush=True)
    elif args.mode == "cluster":
        engine.fuse_cluster(job_id=args.job_id, fast_mode=args.fast_mode)
    else:
        engine.fuse(job_id=args.job_id, fast_mode=args.fast_mode)
