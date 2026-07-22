"""Train the local "AI Gatekeeper" / bouncer model.

This file is intentionally more commented than normal production code because
it is useful in security and architecture reviews.

Important clarification:

- `learner.py` archives search results into CSV.
- `train_bouncer.py` is the file that actually trains the bouncer model.

The training flow is:

1. Read human feedback rows from `trainingData.json` or
   `trainingData_broadcast.json`.
2. Convert each row into the exact same text shape used at runtime.
3. Use the local `local_miniLM_model/` SentenceTransformer folder to turn each
   text row into an embedding vector.
4. Train a small scikit-learn LogisticRegression classifier on those vectors.
5. Save the classifier as `bouncer_model.pkl` or
   `bouncer_model_broadcast.pkl`.

There is no article text upload in this file. The embedder is loaded from a
local filesystem path, and `--offline` additionally sets Hugging Face offline
environment flags before the SentenceTransformer class is imported.
"""

import argparse
import json
import os
import pickle
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split

BASE_DIR = Path(__file__).resolve().parent

PROFILE_CONFIGS = {
    "default": {
        "training_file": BASE_DIR / "trainingData.json",
        "model_file": BASE_DIR / "bouncer_model.pkl",
    },
    "broadcast": {
        "training_file": BASE_DIR / "trainingData_broadcast.json",
        "model_file": BASE_DIR / "bouncer_model_broadcast.pkl",
    },
}

EMBEDDER_DIR = BASE_DIR / "local_miniLM_model"

# These labels are accepted from older UI/API versions and normalized into the
# two-class model target:
#
#     1 = interested
#     0 = not_interested
#
# The runtime bouncer in main.py expects the same two classes.

INTERESTED_LABELS = {"interested", "like", "liked", "keep", "relevant", "up"}
NOT_INTERESTED_LABELS = {
    "not_interested",
    "not_intrested",
    "dislike",
    "irrelevant",
    "drop",
    "down",
}


def configure_offline_environment():
    """Force local-only behavior for Hugging Face model loading.

    This is used by the terminal proof command. It must run before importing
    SentenceTransformer, so this file imports SentenceTransformer lazily inside
    `load_embedder()`.
    """

    # Project-specific flag. Other files also read this flag to disable online
    # fallback behavior.
    os.environ["SENSE_OFFLINE_ONLY"] = "1"

    # Standard Hugging Face / Transformers offline flags. If a library tries to
    # resolve a missing model through the Hub, it should fail locally instead.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_DATASETS_OFFLINE"] = "1"

    # Avoid noisy tokenizer multiprocessing warnings during terminal demos.
    os.environ["TOKENIZERS_PARALLELISM"] = "false"


def normalize_label(raw_label):
    """Convert a stored vote to 0=not_interested or 1=interested."""

    label = str(raw_label or "").strip().lower()

    if label in NOT_INTERESTED_LABELS:
        return 0

    if label in INTERESTED_LABELS:
        return 1

    # Unknown labels are skipped. This prevents accidental values from silently
    # poisoning the classifier.
    return None


def normalize_keywords(keywords):
    """Normalize UI/API keyword shapes into one readable keyword string."""

    # Current UI usually sends a list: ["Samsung", "OLED"].
    if isinstance(keywords, list):
        return ", ".join(str(k).strip() for k in keywords if str(k).strip())

    # Some old rows may have null keywords.
    if keywords is None:
        return ""

    # Some old rows may already have comma-separated strings.
    return str(keywords).strip()


def build_training_text(title, keywords, summary):
    """Keep training text identical to the runtime bouncer text in main.py.

    This is very important. If training used a different text format than
    runtime prediction, the model would learn from one representation but score
    another representation in production.
    """

    return (
        f"Title: {str(title or '').strip()}\n"
        f"Keywords: {normalize_keywords(keywords)}\n"
        f"Summary: {str(summary or '').strip()}"
    )


def deduplicate_training_data(data):
    """Keep the latest vote for each title and summary pair."""

    # Keyed by normalized title + first 200 chars of normalized summary. If a
    # user changes their mind later, the later row replaces the earlier row.
    seen = {}

    for item in data:
        title = str(item.get("title", "") or "").strip().lower()
        summary = str(item.get("summary", "") or "").strip().lower()

        if not summary:
            continue

        seen[f"{title}::{summary[:200]}"] = item

    deduped = list(seen.values())
    removed = len(data) - len(deduped)

    if removed > 0:
        print(f"Removed {removed} duplicate rows. Training on {len(deduped)} unique rows.")

    return deduped


def load_training_data(training_file):
    """Load human feedback rows from the selected profile training file."""

    if not training_file.exists():
        print(f"ERROR: Cannot find {training_file}")
        return []

    try:
        with open(training_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, list):
            print(f"ERROR: {training_file.name} should contain a list.")
            return []

        return data

    except json.JSONDecodeError as e:
        print(f"ERROR: {training_file.name} is invalid JSON: {e}")
        return []

    except Exception as e:
        print(f"ERROR: Could not read {training_file.name}: {e}")
        return []


def prepare_dataset(data):
    """Convert raw feedback rows into model-ready texts and numeric labels."""

    texts = []
    labels = []
    skipped_unknown_label = 0
    skipped_empty_summary = 0

    for item in data:
        title = item.get("title", "")
        summary = item.get("summary", "")
        keywords = item.get("keyword", item.get("keywords", []))
        target = normalize_label(item.get("label", ""))

        # Empty summaries do not contain enough signal for embedding training.
        if not str(summary or "").strip():
            skipped_empty_summary += 1
            continue

        # Unknown labels are ignored rather than guessed.
        if target is None:
            skipped_unknown_label += 1
            continue

        # The MiniLM embedder converts this natural-language text into a vector.
        texts.append(build_training_text(title, keywords, summary))
        labels.append(target)

    if skipped_empty_summary:
        print(f"Skipped {skipped_empty_summary} rows with empty summary.")

    if skipped_unknown_label:
        print(f"Skipped {skipped_unknown_label} rows with unknown labels.")

    return texts, labels


def print_threshold_analysis(clf, X, y):
    """Show how different drop thresholds would behave on training data."""

    # LogisticRegression supports predict_proba. This guard keeps the function
    # safe if the classifier is ever changed.
    if not hasattr(clf, "predict_proba"):
        return

    probas = clf.predict_proba(X)
    class_list = list(clf.classes_)

    if 0 not in class_list:
        print("Cannot run threshold analysis: class 0 missing.")
        return

    # Probability that each row belongs to class 0 = not_interested.
    not_interested_confidence = probas[:, class_list.index(0)]
    not_interested_rows = not_interested_confidence[y == 0]
    interested_rows = not_interested_confidence[y == 1]

    print("\nThreshold Analysis")
    for threshold in [0.50, 0.60, 0.70, 0.80, 0.90]:
        blocked_junk = int(np.sum(not_interested_rows >= threshold))
        false_blocked_good = int(np.sum(interested_rows >= threshold))
        print(
            f"Threshold {threshold:.2f}: blocks {blocked_junk}/{len(not_interested_rows)} "
            f"not_interested, false-blocks {false_blocked_good}/{len(interested_rows)} interested"
        )


def load_sentence_transformer_class():
    """Import SentenceTransformer only when the embedder is actually needed.

    Lazy import lets `--offline` set environment variables before Hugging Face
    helper code initializes.
    """

    from sentence_transformers import SentenceTransformer

    return SentenceTransformer


def load_embedder(offline=False):
    """Load the local MiniLM/SentenceTransformer folder from disk."""

    if offline:
        configure_offline_environment()

    if not EMBEDDER_DIR.exists():
        print(f"ERROR: Local MiniLM model folder missing: {EMBEDDER_DIR}")
        raise SystemExit(1)

    print(f"Loading AI embedding model from: {EMBEDDER_DIR}")

    try:
        SentenceTransformer = load_sentence_transformer_class()

        # str(EMBEDDER_DIR) is a filesystem path, not a Hugging Face model name.
        # In offline proof mode, outbound sockets are also blocked.
        embedder = SentenceTransformer(str(EMBEDDER_DIR))
        print("Embedding model loaded.")
        return embedder

    except Exception as e:
        print(f"ERROR: Could not load MiniLM model: {e}")
        raise SystemExit(1)


def create_classifier():
    """Create the small local classifier trained on embedding vectors."""

    return LogisticRegression(
        # balanced handles cases where interested/not_interested counts differ.
        class_weight="balanced",
        # Higher max_iter prevents convergence warnings on small/noisy datasets.
        max_iter=2000,
        # Regularization strength. C=1.0 is sklearn's conservative default.
        C=1.0,
        # lbfgs is stable for small dense embedding datasets.
        solver="lbfgs",
        # Keep repeat training deterministic.
        random_state=42,
    )


def train_model(profile="default", training_file=None, model_file=None, offline=False):
    """Train one profile-specific bouncer model."""

    profile = str(profile or "default").strip().lower()

    if profile not in PROFILE_CONFIGS:
        print(f"ERROR: Unknown profile: {profile}")
        return False

    config = PROFILE_CONFIGS[profile]

    # Allow proof/demo commands to point at temporary training/model paths while
    # production calls use the profile defaults.
    training_file = Path(training_file) if training_file else config["training_file"]
    model_file = Path(model_file) if model_file else config["model_file"]

    print(f"\nTraining Bouncer Profile: {profile}")
    print(f"Reading training data from: {training_file}")
    print(f"Will save model to:        {model_file}")
    print(f"Offline mode:              {'enabled' if offline else 'disabled'}")

    data = deduplicate_training_data(load_training_data(training_file))

    if not data:
        print("ERROR: No training data found.")
        return False

    texts, labels = prepare_dataset(data)

    if not texts:
        print("ERROR: No valid training rows after cleaning.")
        return False

    # A binary classifier needs examples from both classes.
    if len(set(labels)) < 2:
        print("ERROR: At least one interested and one not_interested example is required.")
        return False

    print(f"Total usable rows: {len(texts)}")
    print(f"Interested: {sum(1 for label in labels if label == 1)}")
    print(f"Not Interested: {sum(1 for label in labels if label == 0)}")

    # Local MiniLM converts each training text into a numeric embedding vector.
    X = load_embedder(offline=offline).encode(texts, show_progress_bar=False)

    # y is the numeric target vector: 0=not_interested, 1=interested.
    y = np.array(labels)
    interested_count = int(np.sum(y == 1))
    not_interested_count = int(np.sum(y == 0))

    # Only run held-out validation when there are enough examples to split
    # without creating useless/unstable validation sets.
    if len(y) >= 10 and min(interested_count, not_interested_count) >= 3:
        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y,
            test_size=0.25,
            stratify=y,
            random_state=42,
        )
        validation_clf = create_classifier()
        validation_clf.fit(X_train, y_train)
        validation_predictions = validation_clf.predict(X_test)

        print(
            f"Held-out accuracy on {len(y_test)} rows: "
            f"{accuracy_score(y_test, validation_predictions) * 100:.2f}%"
        )
        print(
            classification_report(
                y_test,
                validation_predictions,
                labels=[0, 1],
                target_names=["not_interested", "interested"],
                zero_division=0,
            )
        )
    else:
        print("Held-out validation skipped until each label has at least 3 samples and 10 rows exist.")

    # Final model is trained on every usable row, because this is the artifact
    # saved for runtime predictions.
    clf = create_classifier()
    clf.fit(X, y)

    predictions = clf.predict(X)

    print(f"Final-fit accuracy on {len(texts)} rows: {accuracy_score(y, predictions) * 100:.2f}%")
    print(
        classification_report(
            y,
            predictions,
            labels=[0, 1],
            target_names=["not_interested", "interested"],
            zero_division=0,
        )
    )
    print_threshold_analysis(clf, X, y)

    # Ensure custom proof output folders exist.
    model_file.parent.mkdir(parents=True, exist_ok=True)

    # Save only the small sklearn classifier. The MiniLM embedder remains in
    # local_miniLM_model/ and is loaded separately at runtime.
    with open(model_file, "wb") as f:
        pickle.dump(clf, f)

    print(f"Bouncer model saved to: {model_file}")
    return True


def parse_args():
    """Command-line options for production retrain and offline proof retrain."""

    parser = argparse.ArgumentParser(description="Train profile-specific bouncer model.")
    parser.add_argument("--profile", default="default", choices=["default", "broadcast"])
    parser.add_argument("--training-file", default=None)
    parser.add_argument("--model-file", default=None)
    parser.add_argument(
        "--offline",
        action="store_true",
        default=False,
        help=(
            "Set Hugging Face offline flags before loading the local MiniLM "
            "embedder. Use this for terminal offline proof runs."
        ),
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    train_model(
        profile=args.profile,
        training_file=args.training_file,
        model_file=args.model_file,
        offline=args.offline,
    )
