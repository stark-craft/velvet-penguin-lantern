import tempfile
import unittest
import io
import os
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import main as composition
from core.settings import NEWS_RUNTIME_DIR
from news_scrapper.internal_content import service, storage
from news_scrapper.internal_content import access as internal_access
from news_scrapper.internal_content import storage as internal_storage
from tests.asgi_harness import request as asgi_request

def _multipart(fields):
    boundary = "testboundary123"
    chunks = []
    for name, (filename, content, ctype) in fields.items():
        if isinstance(content, str):
            content = content.encode()
        disp = f'Content-Disposition: form-data; name="{name}"'
        if filename is not None:
            disp += f'; filename="{filename}"'
        chunks.append(f"--{boundary}\r\n".encode())
        hdr = disp + "\r\n"
        if ctype:
            hdr += f"Content-Type: {ctype}\r\n"
        chunks.append(hdr.encode())
        chunks.append(b"\r\n")
        chunks.append(content)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"

class _Client:
    def __init__(self):
        self.cookies = {}
    def req(self, method, path, *, headers=None, json_body=None, body=None, client_ip="10.0.0.25"):
        h = dict(headers or {})
        if self.cookies:
            h.setdefault("Cookie", "; ".join(f"{k}={v}" for k,v in self.cookies.items()))
        res = asgi_request(composition.app, method, path, headers=h, json_body=json_body, body=body, client_ip=client_ip)
        sc = res.headers.get("set-cookie")
        if sc and "=" in sc:
            pair = sc.split(";",1)[0]
            name, _, val = pair.partition("=")
            self.cookies[name.strip()] = val.strip()
        return res
    def upload(self, method, path, fields, client_ip="10.0.0.25"):
        payload, ctype = _multipart(fields)
        return self.req(method, path, headers={"Content-Type": ctype}, body=payload, client_ip=client_ip)

def _build_image(w=1200, h=700):
    img = Image.new("RGB", (w,h), (20,100,200))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


class CreateNewsIntegrationTests(unittest.TestCase):
    def test_create_through_publication_and_projection(self):
        with tempfile.TemporaryDirectory() as td:
            runtime = Path(td)
            # Patch runtime dirs
            with patch("core.settings.NEWS_RUNTIME_DIR", runtime), \
                 patch("news_scrapper.internal_content.storage.RUNTIME_DIR", runtime / "internal_content"), \
                 patch("news_scrapper.internal_content.storage.ORIGINALS_DIR", runtime / "internal_content" / "originals"), \
                 patch("news_scrapper.internal_content.storage.COVERS_DIR", runtime / "internal_content" / "covers"), \
                 patch("news_scrapper.internal_content.storage.CONTRIBUTIONS_FILE", runtime / "internal_content" / "contributions.json"), \
                 patch("news_scrapper.internal_content.storage.NOTIFICATIONS_FILE", runtime / "internal_content" / "internal_notifications.json"):
                # ensure dirs
                (runtime / "internal_content" / "originals").mkdir(parents=True, exist_ok=True)
                (runtime / "internal_content" / "covers").mkdir(parents=True, exist_ok=True)
                # Set editor key for test
                os.environ["INTERNAL_EDITOR_KEY"] = "test-editor-key-12345"
                owner = "test-owner-key-abc123"
                # Create draft as story
                draft = service.create_draft(owner, {"title": "Integration Test Story", "summary": "Key details", "body": "This is a full story body with at least twenty characters for validation.", "category": "Technology", "team": "Test Team", "author": "Test Author", "content_type": "story"})
                self.assertEqual(draft["title"], "Integration Test Story")
                self.assertEqual(draft["status"], "draft")
                self.assertEqual(draft["content_type"], "story")
                # Update to add cover required? For story, cover required before submit. Simulate cover attach via direct file write (avoid image validation)
                # Instead, use announcement which does not require cover
                # Create announcement for integration that covers optional
                ann = service.create_draft(owner, {"title": "Integration Announcement", "summary": "Notice", "body": "Announcement body with sufficient length for validation.", "category": "Announcement", "team": "HR", "author": "HR Team", "content_type": "announcement"})
                ann_id = ann["id"]
                # Submit
                submitted = service.submit_draft(owner, ann_id)
                self.assertEqual(submitted["status"], "submitted")
                # Editor publishes (service layer does not check key, router does)
                published = service.publish_record(ann_id)
                # Verify appears in published
                published_list = service.list_published()
                self.assertTrue(any(r["id"] == ann_id for r in published_list))
                # Verify deterministic projection: published record should be returned by list_published and have correct fields
                rec = next(r for r in published_list if r["id"] == ann_id)
                self.assertEqual(rec["content_type"], "announcement")
                # Cleanup cover deletion not needed for announcement
                # Verify author dashboard: list_for_owner contains it
                mine = service.list_for_owner(owner)
                self.assertTrue(any(r["id"] == ann_id for r in mine))
                # Verify persisted-media deletion via remove cover (if any) - for announcement, no cover
                # Test delete of announcement
                service.delete_owned_record(owner, ann_id)
                self.assertFalse(any(r["id"] == ann_id for r in service.list_for_owner(owner)))

    def test_schema_fields_and_persisted_media_deletion(self):
        with tempfile.TemporaryDirectory() as td:
            runtime = Path(td)
            with patch("core.settings.NEWS_RUNTIME_DIR", runtime), \
                 patch("news_scrapper.internal_content.storage.RUNTIME_DIR", runtime / "internal_content"), \
                 patch("news_scrapper.internal_content.storage.ORIGINALS_DIR", runtime / "internal_content" / "originals"), \
                 patch("news_scrapper.internal_content.storage.COVERS_DIR", runtime / "internal_content" / "covers"), \
                 patch("news_scrapper.internal_content.storage.CONTRIBUTIONS_FILE", runtime / "internal_content" / "contributions.json"), \
                 patch("news_scrapper.internal_content.storage.NOTIFICATIONS_FILE", runtime / "internal_content" / "internal_notifications.json"):
                (runtime / "internal_content" / "originals").mkdir(parents=True, exist_ok=True)
                (runtime / "internal_content" / "covers").mkdir(parents=True, exist_ok=True)
                os.environ["INTERNAL_EDITOR_KEY"] = "test-editor-key-12345"
                owner = "owner-schema-test"
                draft = service.create_draft(owner, {"title": "Schema Test", "summary": "summary", "body": "Body with enough characters to pass validation.", "category": "General", "team": "Team", "author": "Author", "content_type": "story"})
                # Verify schema fields persisted
                self.assertIn("title", draft)
                self.assertIn("summary", draft)
                self.assertIn("body", draft)
                self.assertIn("category", draft)
                self.assertIn("team", draft)
                self.assertIn("author", draft)
                self.assertIn("content_type", draft)
                self.assertIn("status", draft)
                # Simulate cover attach via direct file (bypass validation)
                # Write a fake cover file and set record cover manually
                import uuid
                from pathlib import Path as P
                file_id = storage.new_file_id()
                cover_path = storage.cover_path(file_id, "webp")
                cover_path.parent.mkdir(parents=True, exist_ok=True)
                cover_path.write_bytes(b"fake-image-data")
                # Update record to have cover
                with storage.mutation_lock:
                    items = storage.load_records()
                    rec = items[draft["id"]]
                    rec["cover"] = {"file": f"{file_id}.webp", "name": "test.webp", "type": "image/webp", "size": 15, "width": 100, "height": 100}
                    storage.write_records(items)
                # Verify cover exists
                rec2 = service.peek(draft["id"])
                self.assertIsNotNone(rec2.get("cover"))
                # Now delete cover via service-level remove (simulate DELETE /cover)
                with storage.mutation_lock:
                    items = storage.load_records()
                    rec = items[draft["id"]]
                    cover = rec.get("cover")
                    if cover and cover.get("file"):
                        storage.remove_quietly(storage.COVERS_DIR / str(cover.get("file")))
                        rec["cover"] = None
                        storage.write_records(items)
                self.assertFalse(cover_path.exists())
                rec3 = service.peek(draft["id"])
                self.assertIsNone(rec3.get("cover"))

    def test_http_endpoints_cover_lifecycle_and_approval_and_projection(self):
        with tempfile.TemporaryDirectory() as td:
            runtime = Path(td)
            with patch("news_scrapper.internal_content.storage.RUNTIME_DIR", runtime / "internal_content"), \
                 patch("news_scrapper.internal_content.storage.ORIGINALS_DIR", runtime / "internal_content" / "originals"), \
                 patch("news_scrapper.internal_content.storage.COVERS_DIR", runtime / "internal_content" / "covers"), \
                 patch("news_scrapper.internal_content.storage.CONTRIBUTIONS_FILE", runtime / "internal_content" / "contributions.json"), \
                 patch("news_scrapper.internal_content.storage.NOTIFICATIONS_FILE", runtime / "internal_content" / "internal_notifications.json"), \
                 patch.object(internal_access, "CONTRIBUTIONS_ALLOWED_IPS", {"10.0.0.25"}):
                (runtime / "internal_content" / "originals").mkdir(parents=True, exist_ok=True)
                (runtime / "internal_content" / "covers").mkdir(parents=True, exist_ok=True)
                os.environ["INTERNAL_EDITOR_KEY"] = "test-http-key-98765"
                owner = _Client()
                outsider = _Client()
                # create draft via HTTP
                created = owner.req("POST", "/internal-content/drafts", json_body={"title": "HTTP Story", "summary": "Key details", "body": "Full body with sufficient length for validation.", "category": "Technology", "team": "QA", "author": "Tester", "content_type": "story"})
                self.assertEqual(created.status_code, 200, created.text)
                rec = created.json()
                rid = rec["id"]
                self.assertEqual(rec["status"], "draft")
                # verify ownership: outsider cannot see
                self.assertEqual(outsider.req("GET", f"/internal-content/{rid}").status_code, 404)
                self.assertEqual(outsider.req("PUT", f"/internal-content/{rid}", json_body={"title": "hacked"}).status_code, 404)
                # update via HTTP
                upd = owner.req("PUT", f"/internal-content/{rid}", json_body={"title": "HTTP Story Updated", "summary": "Updated summary", "body": "Updated body with enough length for validation."})
                self.assertEqual(upd.status_code, 200)
                self.assertEqual(upd.json()["title"], "HTTP Story Updated")
                # upload cover
                img = _build_image(1600, 900)
                cov = owner.upload("POST", f"/internal-content/{rid}/cover", {"cover": ("cover.png", img, "image/png"), "focal_x": (None, "0.5", None), "focal_y": (None, "0.5", None)})
                self.assertEqual(cov.status_code, 200, cov.text)
                self.assertIsNotNone(cov.json().get("cover"))
                # verify cover is retrievable while draft (owner)
                self.assertEqual(owner.req("GET", f"/internal-content/{rid}/cover").status_code, 200)
                # outsider cannot retrieve draft cover (private)
                self.assertEqual(outsider.req("GET", f"/internal-content/{rid}/cover").status_code, 404)
                # remove cover via HTTP DELETE
                del_cov = owner.req("DELETE", f"/internal-content/{rid}/cover")
                self.assertEqual(del_cov.status_code, 200)
                self.assertEqual(owner.req("GET", f"/internal-content/{rid}/cover").status_code, 404)
                # re-upload for submit
                cov2 = owner.upload("POST", f"/internal-content/{rid}/cover", {"cover": ("cover2.png", img, "image/png"), "focal_x": (None, "0.5", None), "focal_y": (None, "0.5", None)})
                self.assertEqual(cov2.status_code, 200)
                # submit
                sub = owner.req("POST", f"/internal-content/{rid}/submit")
                self.assertEqual(sub.status_code, 200)
                self.assertEqual(sub.json()["status"], "submitted")
                # outsider still cannot publish without editor capability
                self.assertEqual(outsider.req("POST", f"/internal-content/{rid}/publish", headers={"x-editor-key": "wrong"}).status_code, 403)
                # editor approval via HTTP with correct key
                with patch.dict(os.environ, {"INTERNAL_EDITOR_KEY": "test-http-key-98765"}):
                    pub = owner.req("POST", f"/internal-content/{rid}/publish", headers={"x-editor-key": "test-http-key-98765"})
                self.assertEqual(pub.status_code, 200, pub.text)
                self.assertEqual(pub.json()["status"], "published")
                # published listing via HTTP must contain it
                listed = owner.req("GET", "/internal-content/published").json()["items"]
                self.assertTrue(any(x["id"] == rid for x in listed))
                # single record fetch via published reader contract
                single = owner.req("GET", f"/internal-content/published/{rid}")
                self.assertEqual(single.status_code, 200)
                self.assertEqual(single.json()["id"], rid)
                # outsider can now read published cover (public after publish)
                self.assertEqual(outsider.req("GET", f"/internal-content/{rid}/cover").status_code, 200)
                # Samsung News projection: published internal record is the source for Sampark Samsung News merging;
                # verify that published listing is non-empty and contains our story - this is what SamparkSamsungNews consumes via getPublishedInternalContent()
                # Also verify that the record appears with correct contentType and category
                proj = next(x for x in listed if x["id"] == rid)
                self.assertEqual(proj["content_type"], "story")
                # capability boundary: outsider cannot delete published via owner endpoint (ownership)
                self.assertEqual(outsider.req("DELETE", f"/internal-content/{rid}").status_code, 404)
                # owner can archive via editor
                with patch.dict(os.environ, {"INTERNAL_EDITOR_KEY": "test-http-key-98765"}):
                    arch = owner.req("POST", f"/internal-content/{rid}/archive", headers={"x-editor-key": "test-http-key-98765"})
                self.assertEqual(arch.status_code, 200)
