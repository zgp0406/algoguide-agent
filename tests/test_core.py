from __future__ import annotations

import os
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from docx import Document

from agent import chain, retriever, sessions
from knowledge import library


class IsolatedSessionsMixin:
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


class SessionStorageTests(IsolatedSessionsMixin, unittest.TestCase):
    def test_append_turn_persists_messages_and_summary(self) -> None:
        saved = sessions.append_turn(
            None,
            user_message="讲一下 BFS",
            assistant_message="BFS 适合按层遍历图。",
            assistant_sources=["graph_bfs_dfs.md"],
            assistant_evidence=[{"source": "graph_bfs_dfs.md", "excerpt": "BFS 使用队列。"}],
            assistant_used_rag=True,
        )

        loaded = sessions.get_session(str(saved["id"]))

        self.assertIsNotNone(loaded)
        assert loaded is not None
        self.assertEqual(len(loaded["messages"]), 2)
        self.assertEqual(loaded["messages"][1]["sources"], ["graph_bfs_dfs.md"])
        self.assertTrue(loaded["messages"][1]["used_rag"])
        self.assertIn("BFS", loaded["summary"])


class DocumentParsingTests(unittest.TestCase):
    def test_docx_upload_parsing_builds_preview_chunks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            doc_path = Path(tmp) / "algorithm.docx"
            document = Document()
            document.add_paragraph("动态规划适合处理具有重叠子问题和最优子结构的问题。")
            document.add_paragraph("状态定义、状态转移和初始化是 DP 讲解的核心。")
            document.save(doc_path)

            parsed = library.parse_uploaded_document(doc_path.name, doc_path.read_bytes())

        self.assertEqual(parsed["file_name"], "algorithm.docx")
        self.assertGreater(parsed["chunk_count"], 0)
        self.assertGreater(parsed["text_quality"], 0)
        self.assertTrue(parsed["preview_chunks"])


class KnowledgeManagementTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.original_paths = {
            "DATA_DIR": library.DATA_DIR,
            "STORE_PATH": library.STORE_PATH,
            "DRAFTS_DIR": library.DRAFTS_DIR,
            "DOCS_DIR": library.DOCS_DIR,
            "_INITIALIZED": library._INITIALIZED,
        }
        library.DATA_DIR = self.root / "data"
        library.STORE_PATH = library.DATA_DIR / "knowledge_store.json"
        library.DRAFTS_DIR = library.DATA_DIR / "knowledge_drafts"
        library.DOCS_DIR = self.root / "docs"
        library._INITIALIZED = False
        library.DATA_DIR.mkdir(parents=True, exist_ok=True)
        library.DOCS_DIR.mkdir(parents=True, exist_ok=True)
        store = {
            "knowledge_bases": [
                {
                    "id": library.BUILTIN_KB_ID,
                    "name": library.BUILTIN_KB_NAME,
                    "kind": "builtin",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                },
                {
                    "id": "kb_custom",
                    "name": "旧知识库",
                    "kind": "custom",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                },
            ],
            "documents": [
                {
                    "id": "doc_custom",
                    "source_key": "upload:test",
                    "knowledge_base_id": "kb_custom",
                    "knowledge_base_name": "旧知识库",
                    "source_type": "upload",
                    "filename": "dp.docx",
                    "title": "旧标题",
                    "summary": "动态规划",
                    "text": "动态规划关注状态转移。",
                    "blocks": [{"text": "动态规划关注状态转移。", "location": "段落 1"}],
                    "chunks": [
                        {
                            "source": "dp.docx",
                            "knowledge_base_id": "kb_custom",
                            "knowledge_base_name": "旧知识库",
                            "text": "动态规划关注状态转移。",
                            "location": "段落 1",
                            "chunk_index": 0,
                        }
                    ],
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                }
            ],
        }
        library.STORE_PATH.write_text(json.dumps(store, ensure_ascii=False), encoding="utf-8")
        self.rebuild_patch = mock.patch("knowledge.library.rebuild_artifacts", return_value={"faiss_status": "skipped"})
        self.rebuild_patch.start()

    def tearDown(self) -> None:
        self.rebuild_patch.stop()
        library.DATA_DIR = self.original_paths["DATA_DIR"]
        library.STORE_PATH = self.original_paths["STORE_PATH"]
        library.DRAFTS_DIR = self.original_paths["DRAFTS_DIR"]
        library.DOCS_DIR = self.original_paths["DOCS_DIR"]
        library._INITIALIZED = self.original_paths["_INITIALIZED"]
        self.tmp.cleanup()

    def test_rename_knowledge_base_updates_documents_and_chunks(self) -> None:
        result = library.rename_knowledge_base("kb_custom", "新知识库")
        detail = library.get_document_detail("doc_custom")

        self.assertEqual(result["knowledge_base"]["name"], "新知识库")
        assert detail is not None
        self.assertEqual(detail["knowledge_base_name"], "新知识库")
        self.assertEqual(detail["chunks"][0]["text"], "动态规划关注状态转移。")

    def test_rename_builtin_knowledge_base_is_allowed(self) -> None:
        result = library.rename_knowledge_base(library.BUILTIN_KB_ID, "算法基础库")

        self.assertEqual(result["knowledge_base"]["name"], "算法基础库")
        self.assertEqual(result["knowledge_base"]["kind"], "builtin")

    def test_delete_document_removes_it_from_store(self) -> None:
        result = library.delete_document("doc_custom")

        self.assertTrue(result["deleted"])
        self.assertIsNone(library.get_document_detail("doc_custom"))

    def test_update_document_rebuilds_text_blocks_and_chunks(self) -> None:
        result = library.update_document(
            "doc_custom",
            title="新标题",
            text="第一段：前缀和用于快速求区间和。\n\n第二段：动态规划用于状态转移。",
        )
        detail = result["document"]

        self.assertEqual(detail["title"], "新标题")
        self.assertIn("前缀和", detail["text"])
        self.assertGreaterEqual(detail["chunk_count"], 1)
        self.assertIn("前缀和", detail["chunks"][0]["text"])

    def test_confirm_new_kb_draft_ignores_stale_builtin_selection(self) -> None:
        draft_id = "draft_new_kb"
        draft = {
            "draft_id": draft_id,
            "file_name": "new.docx",
            "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "summary": "新知识库文档",
            "extracted_text": "这是新知识库里的内容。",
            "blocks": [{"text": "这是新知识库里的内容。", "location": "段落 1"}],
            "chunks": [
                {
                    "source": "new.docx",
                    "text": "这是新知识库里的内容。",
                    "location": "段落 1",
                    "chunk_index": 0,
                }
            ],
            "target": {
                "knowledge_base_id": "",
                "knowledge_base_name": "新建测试库",
            },
            "created_at": "2026-01-01T00:00:00+00:00",
            "confirmed_at": None,
        }
        library.DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
        (library.DRAFTS_DIR / f"{draft_id}.json").write_text(json.dumps(draft, ensure_ascii=False), encoding="utf-8")

        result = library.confirm_upload_draft(
            draft_id=draft_id,
            knowledge_base_id=library.BUILTIN_KB_ID,
        )

        self.assertEqual(result["knowledge_base"]["name"], "新建测试库")
        self.assertNotEqual(result["knowledge_base"]["id"], library.BUILTIN_KB_ID)
        self.assertEqual(result["document"]["knowledge_base_name"], "新建测试库")

    def test_builtin_knowledge_base_cannot_be_deleted(self) -> None:
        with self.assertRaises(ValueError):
            library.delete_knowledge_base(library.BUILTIN_KB_ID)


class RetrieverFallbackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_store = retriever._STORE_CACHE
        self.signature_patch = mock.patch("agent.retriever._store_signature", return_value=None)
        self.signature_patch.start()
        retriever._STORE_CACHE = retriever.KnowledgeStore(
            chunks=[
                retriever.KnowledgeChunk(
                    knowledge_base_id="kb_test",
                    knowledge_base_name="测试知识库",
                    source="graph.md",
                    text="BFS 使用队列进行层序遍历。",
                    location="段落 1",
                ),
                retriever.KnowledgeChunk(
                    knowledge_base_id="kb_test",
                    knowledge_base_name="测试知识库",
                    source="dp.md",
                    text="动态规划关注状态转移。",
                    location="段落 2",
                ),
            ],
            model_name="test-model",
            faiss_index=None,
            signature=None,
        )

    def tearDown(self) -> None:
        retriever._STORE_CACHE = self.original_store
        self.signature_patch.stop()

    def test_retrieve_uses_lexical_fallback_without_faiss(self) -> None:
        results = retriever.retrieve_with_scores("BFS 队列", k=2)

        self.assertEqual(results[0].source, "graph.md")
        self.assertGreater(results[0].score, 0)


class ChatFallbackTests(IsolatedSessionsMixin, unittest.TestCase):
    def test_chat_without_api_key_returns_local_answer_and_error_type(self) -> None:
        request = chain.ChatRequest(message="怎么讲前缀和？", history=[])

        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False), mock.patch(
            "agent.chain.retrieve_with_scores",
            return_value=[],
        ):
            response = chain.chat(request)

        self.assertIn("当前还没有命中本地知识库", response.answer)
        self.assertEqual(response.error_type, "model_config")
        self.assertIn("OPENAI_API_KEY", response.error or "")
        self.assertIsNotNone(response.session_id)
        self.assertIsNotNone(sessions.get_session(str(response.session_id)))


if __name__ == "__main__":
    unittest.main()
