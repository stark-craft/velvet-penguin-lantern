"""Archive search results for later review/training analysis.

Despite the filename, this file does not train an AI/ML model by itself. It is
the data recorder used by scheduled and manual searches.

What it does:

- receives final article/event results from `main.py`
- flattens older cluster shapes and current fused event shapes
- writes one CSV row per detected keyword into `training_dataset.csv`

What it does not do:

- it does not call Hugging Face
- it does not load MiniLM/BART/FLAN-T5
- it does not send data to the internet
- it does not create `bouncer_model.pkl`

The actual preference-learning model is trained by `train_bouncer.py`, using
human feedback from `trainingData.json` / `trainingData_broadcast.json`.
"""

import csv
import datetime
import threading
from pathlib import Path

# ==========================================
# CONFIGURATION
# ==========================================

# Repository/backend folder. The archive CSV lives next to the backend scripts
# so it works the same from FastAPI, scheduler runs, and terminal demos.
BASE_DIR = Path(__file__).resolve().parent

# Long-term CSV archive. This is useful for audit/export/history, but it is not
# the live bouncer feedback file.
TRAINING_ARCHIVE_FILE = BASE_DIR / "training_dataset.csv"

# Multiple manual/scheduled searches can finish close together. The lock keeps
# two threads from writing to the CSV at exactly the same time.
archive_lock = threading.Lock()


def safe_text(value):
    """Return a clean string for CSV writing."""

    if value is None:
        return ""

    # CSV cells should be scalar text. Lists/dicts are converted to readable
    # strings rather than being written as Python objects.
    if isinstance(value, (list, dict)):
        return str(value)

    return str(value).strip()


def get_article_summary(article):
    """Support both raw spider articles and final clustered articles."""

    # Different pipeline stages use different field names:
    #
    # - master_summary: final fused semantic summary
    # - summary/snippet: raw crawler or lightweight summary
    # - full_contents/full_content: body text fallback
    return (
        safe_text(article.get("master_summary"))
        or safe_text(article.get("summary"))
        or safe_text(article.get("snippet"))
        or safe_text(article.get("full_contents"))[:500]
        or safe_text(article.get("full_content"))[:500]
    )


def get_article_keywords(article, fallback_query):
    """Return cleaned detected keywords, falling back to the search query."""

    keywords = article.get("keywords_found", [])

    # Preferred current shape: ["Samsung", "OLED"].
    if isinstance(keywords, list):
        cleaned = [safe_text(k).strip() for k in keywords if safe_text(k).strip()]
        if cleaned:
            return cleaned

    # Older shape: "Samsung".
    if isinstance(keywords, str) and keywords.strip():
        return [keywords.strip()]

    # Last resort: archive against the user's original query.
    fallback = safe_text(fallback_query)
    return [fallback] if fallback else ["Unknown"]


def flatten_results(results_data):
    """Handle flat fusion events and older article-cluster response shapes."""

    if not isinstance(results_data, list):
        return []

    articles = []

    for item in results_data:
        if not isinstance(item, dict):
            continue

        # Historical shape:
        #
        #     {"cluster": "...", "articles": [{...}, {...}]}
        #
        # Current shape is already one fused event dict.
        if isinstance(item.get("articles"), list):
            articles.extend(
                article for article in item["articles"] if isinstance(article, dict)
            )
        else:
            articles.append(item)

    return articles


def ensure_csv_header(file_path):
    """Create the archive CSV with its schema if it does not exist."""

    if file_path.exists():
        return

    # These columns are deliberately human-readable because this file is used as
    # an audit/export artifact, not as the direct sklearn training matrix.
    with open(file_path, mode="w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow(
            [
                "Timestamp",
                "Specific_Keyword",
                "Headline",
                "Summary",
                "Link",
                "Source",
                "Original_Query",
                "Date",
                "Source_Count",
                "Importance_Score",
                "Category",
            ]
        )


def log_search_data(user_query, results_data):
    """
    Archive search and briefing results into training_dataset.csv.

    This is an audit/archive file only; bouncer training uses trainingData.json.
    """

    try:
        with archive_lock:
            ensure_csv_header(TRAINING_ARCHIVE_FILE)

            # Timestamp marks when this system observed/archived the item.
            now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            # Accept both old cluster shape and new fused event shape.
            articles_to_save = flatten_results(results_data)

            if not articles_to_save:
                print("LEARNER: No articles to archive.")
                return

            rows_written = 0

            with open(TRAINING_ARCHIVE_FILE, mode="a", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)

                for article in articles_to_save:
                    # Normalize common article fields before writing CSV.
                    headline = safe_text(article.get("title"))
                    summary = get_article_summary(article)
                    link = safe_text(article.get("link"))
                    source = safe_text(article.get("source", "Unknown"))
                    article_date = safe_text(article.get("date"))
                    source_count = safe_text(article.get("source_count", 1))
                    importance_score = safe_text(article.get("importance_score", ""))
                    category = safe_text(article.get("category", "Tech News"))
                    keywords = get_article_keywords(article, user_query)

                    # One article can match multiple keywords. Writing one row
                    # per keyword makes later spreadsheet filtering easier.
                    for keyword in keywords:
                        writer.writerow(
                            [
                                now,
                                keyword.strip().title(),
                                headline,
                                summary,
                                link,
                                source,
                                safe_text(user_query),
                                article_date,
                                source_count,
                                importance_score,
                                category,
                            ]
                        )
                        rows_written += 1

        print(f"LEARNER: Archived {rows_written} rows to training_dataset.csv.")

    except Exception as e:
        # Archive failure should not crash the user-facing scan response.
        print(f"LEARNER ERROR: {e}")
