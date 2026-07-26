import json
import os


class LiveStreamPipeline:
    def __init__(self):
        self.enabled = os.environ.get("SENSE_STREAM_ITEMS") == "1"

    def process_item(self, item):
        if self.enabled:
            try:
                payload = json.dumps(dict(item), ensure_ascii=False, default=str)
                print(f"SENSE_STREAM_ITEM:{payload}", flush=True)
            except Exception as exc:
                print(f"LOG: Live stream item emit failed: {exc}", flush=True)

        return item


class NewsAggregatorPipeline:
    def process_item(self, item):
        return item
