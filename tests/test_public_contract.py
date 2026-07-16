import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]


class PublicDemoContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        os.environ["PROCUREFLOW_DEMO"] = "1"
        os.environ["PROCUREFLOW_RUNTIME_DIR"] = cls.temp.name
        os.environ.pop("PROCUREFLOW_ADMIN_TOKEN", None)
        sys.path.insert(0, str(ROOT / "server"))
        sys.modules.pop("main", None)
        cls.main = importlib.import_module("main")
        cls.client = TestClient(cls.main.app)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()
        sys.modules.pop("main", None)

    def test_seed_is_anonymous_and_usable(self):
        seed = json.loads((ROOT / "demo-data" / "seed.json").read_text(encoding="utf-8"))
        raw = json.dumps(seed, ensure_ascii=False).lower()
        self.assertGreaterEqual(len(seed["products"]), 6)
        self.assertGreaterEqual(len(seed["suppliers"]), 3)
        self.assertNotIn("192.168.", raw)
        self.assertNotIn("c:\\users\\", raw)
        self.assertNotIn("vesper", raw)

    def test_health_and_catalog_load(self):
        health = self.client.get("/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["app"], "ProcureFlow Backend")
        data = self.client.get("/api/data")
        self.assertEqual(data.status_code, 200)
        self.assertEqual(len(data.json()["data"]["products"]), 6)

    def test_revision_prevents_overwrite(self):
        original = self.client.get("/api/data").json()["data"]
        changed = json.loads(json.dumps(original))
        changed["activity"].append({"id": "test_save", "type": "test", "message": "isolated", "at": "2026-07-16T10:00:00Z"})
        saved = self.client.post("/api/data", json={"data": changed, "expectedRevision": original["revision"]})
        self.assertEqual(saved.status_code, 200)
        self.assertTrue(saved.json()["ok"])
        stale = self.client.post("/api/data", json={"data": original, "expectedRevision": original["revision"]})
        self.assertEqual(stale.status_code, 200)
        self.assertTrue(stale.json()["conflict"])

    def test_non_demo_writes_require_token(self):
        original_demo, original_token = self.main.DEMO_MODE, self.main.ADMIN_TOKEN
        self.main.DEMO_MODE, self.main.ADMIN_TOKEN = False, "test-secret"
        try:
            data = self.client.get("/api/data").json()["data"]
            denied = self.client.post("/api/data", json={"data": data, "expectedRevision": data["revision"]})
            allowed = self.client.post("/api/data", headers={"X-ProcureFlow-Token": "test-secret"}, json={"data": data, "expectedRevision": data["revision"]})
            self.assertEqual(denied.status_code, 401)
            self.assertEqual(allowed.status_code, 200)
        finally:
            self.main.DEMO_MODE, self.main.ADMIN_TOKEN = original_demo, original_token
