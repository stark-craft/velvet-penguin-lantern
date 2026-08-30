import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.responses import FileResponse
import main as composition
from core.settings import resolve_frontend_dist
from news_scrapper import application
from tests.asgi_harness import request as asgi_request


class FrontendDeploymentTests(unittest.TestCase):
    def test_frontend_dist_auto_detects_source_and_portable_layouts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            portable = root / "frontend" / "dist"
            portable.mkdir(parents=True)
            (portable / "index.html").write_text("portable", encoding="utf-8")
            self.assertEqual(resolve_frontend_dist(root), portable)

            source = root / "news-ui" / "dist"
            source.mkdir(parents=True)
            (source / "index.html").write_text("source", encoding="utf-8")
            self.assertEqual(resolve_frontend_dist(root), source)

            configured = root / "somewhere" / "compiled"
            self.assertEqual(
                resolve_frontend_dist(root, configured_path=str(configured)),
                configured,
            )

    def test_spa_deep_link_is_index_but_api_prefix_never_falls_back(self):
        with tempfile.TemporaryDirectory() as directory:
            dist = Path(directory)
            index = dist / "index.html"
            index.write_text("<html><body>desk</body></html>", encoding="utf-8")
            with patch.object(composition, "abs_frontend_path", str(dist)):
                response = composition.serve_react_app("saved")
                self.assertIsInstance(response, FileResponse)
                self.assertEqual(Path(response.path), index)
                self.assertIn("no-cache", response.headers["cache-control"])
                with self.assertRaises(HTTPException) as api_error:
                    composition.serve_react_app("viewer/saved")
            self.assertEqual(api_error.exception.status_code, 404)

    def test_built_same_origin_serving_keeps_viewer_api_json(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dist = root / "dist"
            dist.mkdir()
            (dist / "index.html").write_text("<html><body>desk</body></html>", encoding="utf-8")
            saved_file = root / "viewer_saved.json"
            claims = application.JsonStore(root / "viewer_identity_claims.json", dict)
            with (
                patch.object(composition, "abs_frontend_path", str(dist)),
                patch.object(application, "VIEWER_SAVED_FILE", str(saved_file)),
                patch.object(application, "PRIVATE_VIEWER_CLAIMS", claims),
            ):
                workspace_spa = asgi_request(
                    composition.app,
                    "GET",
                    "/for-you/following",
                    headers={"accept": "text/html"},
                )
                create_spa = asgi_request(
                    composition.app,
                    "GET",
                    "/for-you/create/contributions",
                    headers={"accept": "text/html"},
                )
                legacy_spa = asgi_request(
                    composition.app,
                    "GET",
                    "/saved/leadership",
                    headers={"accept": "text/html"},
                )
                leadership_reader = asgi_request(
                    composition.app,
                    "GET",
                    "/samsung-internal/leadership/published-id",
                    headers={"accept": "text/html"},
                )
                research_workspace = asgi_request(
                    composition.app,
                    "GET",
                    "/venturelens/models",
                    headers={"accept": "text/html"},
                )
                voc_spa = asgi_request(
                    composition.app,
                    "GET",
                    "/voc",
                    headers={"accept": "text/html"},
                )
                scheduler_spa = asgi_request(
                    composition.app,
                    "GET",
                    "/scheduler",
                    headers={"accept": "text/html"},
                )
                scheduler_api_miss = asgi_request(
                    composition.app,
                    "GET",
                    "/scheduler/not-a-real-endpoint",
                    headers={"accept": "text/html"},
                )
                api = asgi_request(
                    composition.app,
                    "GET",
                    "/viewer/saved",
                    headers={"accept": "application/json"},
                )
            self.assertEqual(workspace_spa.status_code, 200)
            self.assertIn("desk", workspace_spa.text)
            self.assertIn("no-cache", workspace_spa.headers.get("cache-control", ""))
            self.assertEqual(create_spa.status_code, 200)
            self.assertIn("desk", create_spa.text)
            self.assertEqual(legacy_spa.status_code, 200)
            self.assertIn("desk", legacy_spa.text)
            self.assertEqual(leadership_reader.status_code, 200)
            self.assertIn("desk", leadership_reader.text)
            self.assertEqual(research_workspace.status_code, 200)
            self.assertIn("desk", research_workspace.text)
            self.assertEqual(voc_spa.status_code, 200)
            self.assertIn("desk", voc_spa.text)
            self.assertEqual(scheduler_spa.status_code, 200)
            self.assertIn("desk", scheduler_spa.text)
            self.assertEqual(scheduler_api_miss.status_code, 404)
            self.assertEqual(api.status_code, 200)
            self.assertEqual(api.json()["scope"], "current_viewer_only")


if __name__ == "__main__":
    unittest.main()
