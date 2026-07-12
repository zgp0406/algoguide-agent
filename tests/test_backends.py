from __future__ import annotations

import os
import unittest
from unittest import mock

from agent import chain
from agent.backends.base import GenerationRequest, GenerationResult
from agent.backends.factory import create_backend
from agent.backends.langchain import LangChainBackend
from agent.backends.native import NativeBackend
from agent.retriever import RetrievedChunk


class BackendFactoryTests(unittest.TestCase):
    def test_factory_defaults_to_native(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIsInstance(create_backend(), NativeBackend)

    def test_factory_rejects_unknown_backend(self) -> None:
        with mock.patch.dict(os.environ, {"CHAIN_BACKEND": "unknown"}):
            with self.assertRaisesRegex(ValueError, "不支持"):
                create_backend()


class NativeBackendTests(unittest.TestCase):
    def test_generate_uses_shared_request_data(self) -> None:
        backend = NativeBackend()
        response = {
            "choices": [{"message": {"content": "基于证据的回答"}}],
        }
        request = GenerationRequest(
            question="什么是 BFS？",
            context="来源：graph.md\n片段：BFS 使用队列。",
            history=[{"role": "user", "content": "先讲图搜索"}],
            session_summary="正在学习图算法",
        )
        with mock.patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "test-key", "OPENAI_MODEL": "test-model"},
        ), mock.patch.object(backend, "_request", return_value=response) as mocked_request:
            result = backend.generate(request)

        self.assertEqual(result, GenerationResult(answer="基于证据的回答", model="test-model"))
        payload = mocked_request.call_args.args[2]
        messages = payload["messages"]
        self.assertIn("会话摘要", messages[1]["content"])
        self.assertIn("graph.md", messages[-1]["content"])


class FakeRunnable:
    def invoke(self, _payload: dict[str, object]) -> str:
        return "完整回答"

    def stream(self, _payload: dict[str, object]):
        yield "增量"
        yield "回答"


class FakeBackend:
    def generate(self, _request: GenerationRequest) -> GenerationResult:
        return GenerationResult(answer="后端回答", model="test-model")

    def stream(self, _request: GenerationRequest):
        yield "后端"
        yield "回答"


class ChainBackendIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.context_result = (
            "来源：graph.md\n片段：BFS 使用队列。",
            ["graph.md"],
            [{"source": "graph.md", "excerpt": "BFS 使用队列。"}],
            True,
            "全库检索",
            0.88,
            "hybrid",
            None,
        )

    def test_chat_uses_selected_backend(self) -> None:
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), mock.patch(
            "agent.chat.build_context",
            return_value=self.context_result,
        ), mock.patch(
            "agent.chat.create_backend",
            return_value=FakeBackend(),
        ), mock.patch(
            "agent.chat._save_turn",
            return_value=("session-1", None),
        ), mock.patch(
            "agent.chat.get_session",
            return_value=None,
        ):
            response = chain.chat(chain.ChatRequest(message="什么是 BFS？"))

        self.assertEqual(response.answer, "后端回答")
        self.assertEqual(response.sources, ["graph.md"])
        self.assertTrue(response.used_rag)

    def test_stream_keeps_meta_delta_done_order(self) -> None:
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), mock.patch(
            "agent.stream.build_context",
            return_value=self.context_result,
        ), mock.patch(
            "agent.stream.create_backend",
            return_value=FakeBackend(),
        ), mock.patch(
            "agent.stream._save_user_message",
            return_value=("session-1", None),
        ), mock.patch(
            "agent.stream._save_answer_message",
            return_value=("session-1", None),
        ), mock.patch(
            "agent.stream.get_session",
            return_value=None,
        ):
            events = b"".join(chain.stream_chat(chain.ChatRequest(message="什么是 BFS？"))).decode("utf-8")

        event_names = [
            line.removeprefix("event: ")
            for line in events.splitlines()
            if line.startswith("event: ")
        ]
        self.assertEqual(event_names, ["meta", "delta", "delta", "done"])


class LangChainBackendTests(unittest.TestCase):
    def setUp(self) -> None:
        # 绕过真实模型初始化，只验证统一协议和 LCEL 输出的适配。
        self.backend = LangChainBackend.__new__(LangChainBackend)
        self.backend.model_name = "test-model"
        self.backend._chain = FakeRunnable()
        self.request = GenerationRequest(
            question="解释前缀和",
            context="前缀和用于快速求区间和。",
            history=[],
        )

    def test_generate_returns_unified_result(self) -> None:
        result = self.backend.generate(self.request)
        self.assertEqual(result, GenerationResult(answer="完整回答", model="test-model"))

    def test_stream_yields_text_chunks(self) -> None:
        self.assertEqual(list(self.backend.stream(self.request)), ["增量", "回答"])


class LangChainRetrieverTests(unittest.TestCase):
    def test_adapter_preserves_metadata(self) -> None:
        fake_document_class = mock.Mock(side_effect=lambda **kwargs: kwargs)
        fake_documents_module = mock.Mock(Document=fake_document_class)
        chunk = RetrievedChunk(
            knowledge_base_id="kb_graph",
            knowledge_base_name="图算法",
            source="graph.md",
            text="BFS 使用队列。",
            location="段落 2",
            score=0.88,
            retrieval_mode="hybrid",
        )
        with mock.patch.dict(
            "sys.modules",
            {"langchain_core.documents": fake_documents_module},
        ), mock.patch(
            "agent.langchain_retriever.retrieve_with_scores",
            return_value=[chunk],
        ):
            from agent.langchain_retriever import retrieve_documents

            documents = retrieve_documents("BFS")

        self.assertEqual(documents[0]["page_content"], chunk.text)
        self.assertEqual(documents[0]["metadata"]["source"], "graph.md")
        self.assertEqual(documents[0]["metadata"]["score"], 0.88)
        self.assertEqual(documents[0]["metadata"]["retrieval_mode"], "hybrid")
