from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

import app as app_module
from agent import sessions


class IsolatedSessionsMixin:
    """隔离会话存储到临时目录，避免污染真实数据。"""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.tmp.name)
        self.original_session_paths = {
            "DATA_DIR": sessions.DATA_DIR,
            "SESSIONS_JSON_PATH": sessions.SESSIONS_JSON_PATH,
            "SESSIONS_DB_PATH": sessions.SESSIONS_DB_PATH,
            "SESSIONS_LEGACY_MIGRATED_PATH": sessions.SESSIONS_LEGACY_MIGRATED_PATH,
            "_INITIALIZED": sessions._INITIALIZED,
        }
        sessions.DATA_DIR = self.data_dir
        sessions.SESSIONS_JSON_PATH = self.data_dir / "sessions.json"
        sessions.SESSIONS_DB_PATH = self.data_dir / "sessions_store.sqlite3"
        sessions.SESSIONS_LEGACY_MIGRATED_PATH = self.data_dir / "sessions_legacy_imported.flag"
        sessions._INITIALIZED = False

    def tearDown(self) -> None:
        sessions.DATA_DIR = self.original_session_paths["DATA_DIR"]
        sessions.SESSIONS_JSON_PATH = self.original_session_paths["SESSIONS_JSON_PATH"]
        sessions.SESSIONS_DB_PATH = self.original_session_paths["SESSIONS_DB_PATH"]
        sessions.SESSIONS_LEGACY_MIGRATED_PATH = self.original_session_paths["SESSIONS_LEGACY_MIGRATED_PATH"]
        sessions._INITIALIZED = self.original_session_paths["_INITIALIZED"]
        self.tmp.cleanup()


class HealthAndStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app_module.app)

    def test_health_returns_ok(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_status_without_api_key_reports_not_ready(self) -> None:
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False):
            # Force cache refresh by patching the TTL
            with mock.patch("agent.chat._API_STATUS_CACHE", None):
                response = self.client.get("/api/status")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertFalse(data["ready"])
        self.assertIn("API Key", data["message"])

    def test_status_with_api_key_reports_ready(self) -> None:
        with mock.patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "test-key", "OPENAI_MODEL": "test-model"},
            clear=False,
        ):
            with mock.patch("agent.chat._API_STATUS_CACHE", None):
                response = self.client.get("/api/status")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ready"])

    def test_diagnostics_returns_all_sections(self) -> None:
        response = self.client.get("/api/diagnostics")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        for section in ["api", "retrieval", "knowledge", "storage", "ocr", "system"]:
            self.assertIn(section, data)


class ChatEndpointTests(IsolatedSessionsMixin, unittest.TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.client = TestClient(app_module.app)

    def test_chat_without_api_key_returns_fallback(self) -> None:
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False), mock.patch(
            "agent.context.retrieve_with_scores", return_value=[]
        ):
            response = self.client.post(
                "/api/chat",
                json={"message": "解释一下 BFS", "history": []},
            )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("当前还没有命中本地知识库", data["answer"])
        self.assertFalse(data["used_rag"])
        self.assertEqual(data["error_type"], "model_config")
        self.assertIsNotNone(data["session_id"])

    def test_chat_stream_sse_format(self) -> None:
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False), mock.patch(
            "agent.context.retrieve_with_scores", return_value=[]
        ):
            response = self.client.post(
                "/api/chat/stream",
                json={"message": "讲一下动态规划", "history": []},
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers.get("content-type", ""))

        # Parse SSE events from response body
        text = response.text

        events: list[tuple[str, dict]] = []
        for block in text.strip().split("\n\n"):
            if not block.strip():
                continue
            event_name = ""
            event_data = {}
            for line in block.split("\n"):
                if line.startswith("event: "):
                    event_name = line.removeprefix("event: ").strip()
                elif line.startswith("data: "):
                    try:
                        event_data = json.loads(line.removeprefix("data: "))
                    except json.JSONDecodeError:
                        pass
            if event_name:
                events.append((event_name, event_data))

        self.assertGreater(len(events), 0)
        event_names = [name for name, _ in events]
        self.assertEqual(event_names[0], "meta")
        self.assertEqual(event_names[-1], "done")
        self.assertTrue(any(name == "delta" for name in event_names))
        # meta must come before any delta
        meta_index = event_names.index("meta")
        for i, name in enumerate(event_names):
            if name == "delta":
                self.assertGreater(i, meta_index)


class SessionEndpointTests(IsolatedSessionsMixin, unittest.TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.client = TestClient(app_module.app)

    def test_sessions_list_initially_empty(self) -> None:
        response = self.client.get("/api/sessions")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("sessions", data)
        self.assertEqual(data["sessions"], [])

    def test_session_lifecycle_create_rename_delete(self) -> None:
        # Create a session by chatting
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False), mock.patch(
            "agent.context.retrieve_with_scores", return_value=[]
        ):
            chat_response = self.client.post(
                "/api/chat",
                json={"message": "讲一下前缀和", "history": []},
            )
        session_id = chat_response.json()["session_id"]

        # List sessions should include it
        list_response = self.client.get("/api/sessions")
        sessions_data = list_response.json()["sessions"]
        self.assertEqual(len(sessions_data), 1)
        self.assertEqual(sessions_data[0]["id"], session_id)

        # Get session detail
        detail_response = self.client.get(f"/api/sessions/{session_id}")
        self.assertEqual(detail_response.status_code, 200)
        self.assertIn("session", detail_response.json())

        # Rename session
        rename_response = self.client.put(
            f"/api/sessions/{session_id}/title",
            json={"title": "前缀和学习"},
        )
        self.assertEqual(rename_response.status_code, 200)
        self.assertEqual(rename_response.json()["session"]["title"], "前缀和学习")

        # Delete session
        delete_response = self.client.delete(f"/api/sessions/{session_id}")
        self.assertEqual(delete_response.status_code, 200)
        self.assertTrue(delete_response.json()["deleted"])

        # Verify gone
        detail_after = self.client.get(f"/api/sessions/{session_id}")
        self.assertIsNone(detail_after.json()["session"])


class KnowledgeEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app_module.app)

    def test_knowledge_bases_list_includes_builtin(self) -> None:
        response = self.client.get("/api/knowledge-bases")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("knowledge_bases", data)
        self.assertIn("default_knowledge_base_id", data)
        kb_ids = [kb["id"] for kb in data["knowledge_bases"]]
        self.assertIn(data["default_knowledge_base_id"], kb_ids)

    def test_knowledge_upload_without_file_returns_422(self) -> None:
        response = self.client.post("/api/knowledge/upload")
        self.assertEqual(response.status_code, 422)

    def test_knowledge_upload_rejects_oversized_file(self) -> None:
        with mock.patch.dict(os.environ, {"UPLOAD_MAX_BYTES": "100"}, clear=False):
            response = self.client.post(
                "/api/knowledge/upload",
                files={"file": ("large.txt", b"x" * 200, "text/plain")},
            )
        self.assertEqual(response.status_code, 413)
        self.assertIn("文件过大", response.json()["detail"])


class DiagnosticsEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app_module.app)

    def test_diagnostics_all_sections_present(self) -> None:
        response = self.client.get("/api/diagnostics")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        for section in ["api", "retrieval", "knowledge", "storage", "ocr", "system"]:
            self.assertIn(section, data)
            self.assertIsInstance(data[section], dict)


if __name__ == "__main__":
    unittest.main()
