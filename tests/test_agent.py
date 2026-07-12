from __future__ import annotations

import json
import os
import unittest
from unittest import mock

from agent.backends.base import AgentResponse, ToolCall
from agent.tools import execute_tool, get_tool_definitions


class ToolDefinitionTests(unittest.TestCase):
    def test_all_tools_have_required_fields(self) -> None:
        tools = get_tool_definitions()
        self.assertGreaterEqual(len(tools), 3)
        for tool in tools:
            self.assertEqual(tool["type"], "function")
            func = tool["function"]
            self.assertIn("name", func)
            self.assertIn("description", func)
            self.assertIn("parameters", func)
            self.assertIn("required", func["parameters"])
            self.assertIn("properties", func["parameters"])

    def test_tool_names_are_unique(self) -> None:
        tools = get_tool_definitions()
        names = [t["function"]["name"] for t in tools]
        self.assertEqual(len(names), len(set(names)))


class ToolExecutionTests(unittest.TestCase):
    def test_search_knowledge_returns_results(self) -> None:
        with mock.patch("agent.tools.retrieve_with_scores") as mock_retrieve:
            from agent.retriever import RetrievedChunk
            mock_retrieve.return_value = [
                RetrievedChunk("kb1", "测试库", "dp.md", "动态规划关注状态转移。", "段落 1", 0.88, "hybrid"),
            ]
            result = execute_tool("search_knowledge", {"query": "动态规划"})

        self.assertIn("results", result)
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["results"][0]["source"], "dp.md")

    def test_search_knowledge_rejects_empty_query(self) -> None:
        result = execute_tool("search_knowledge", {"query": ""})
        self.assertIn("error", result)

    def test_search_knowledge_handles_no_results(self) -> None:
        with mock.patch("agent.tools.retrieve_with_scores", return_value=[]):
            result = execute_tool("search_knowledge", {"query": "不存在的概念"})
        self.assertEqual(result["count"], 0)
        self.assertIn("message", result)

    def test_run_python_executes_code(self) -> None:
        result = execute_tool("run_python", {"code": "print('hello agent')"})
        self.assertIn("output", result)
        self.assertIn("hello agent", result["output"])
        self.assertEqual(result["exit_code"], 0)

    def test_run_python_handles_error(self) -> None:
        result = execute_tool("run_python", {"code": "1/0"})
        self.assertIn("output", result)
        self.assertNotEqual(result["exit_code"], 0)

    def test_run_python_timeout(self) -> None:
        result = execute_tool("run_python", {"code": "while True: pass"})
        self.assertIn("error", result)
        self.assertIn("超时", result["error"])

    def test_run_python_rejects_empty_code(self) -> None:
        result = execute_tool("run_python", {"code": ""})
        self.assertIn("error", result)

    def test_unknown_tool_returns_error(self) -> None:
        result = execute_tool("nonexistent_tool", {})
        self.assertIn("error", result)

    def test_get_document_detail_rejects_empty_source(self) -> None:
        result = execute_tool("get_document_detail", {"source": ""})
        self.assertIn("error", result)


class AgentResponseTests(unittest.TestCase):
    def test_agent_response_text_type(self) -> None:
        resp = AgentResponse(type="text", content="这是直接回答", model="test-model")
        self.assertEqual(resp.type, "text")
        self.assertEqual(resp.content, "这是直接回答")
        self.assertEqual(resp.tool_calls, [])

    def test_agent_response_tool_calls_type(self) -> None:
        tc = ToolCall(id="call_1", name="search_knowledge", arguments={"query": "BFS"})
        resp = AgentResponse(type="tool_calls", tool_calls=[tc], model="test-model")
        self.assertEqual(resp.type, "tool_calls")
        self.assertEqual(len(resp.tool_calls), 1)
        self.assertEqual(resp.tool_calls[0].name, "search_knowledge")


class BackendFunctionCallingTests(unittest.TestCase):
    def test_generate_with_tools_includes_tools_in_payload(self) -> None:
        from agent.backends.native import NativeBackend

        backend = NativeBackend()
        messages = [{"role": "user", "content": "解释 BFS"}]
        tools = get_tool_definitions()

        fake_response = {
            "choices": [{"message": {"content": "BFS 是一种图遍历算法..."}}],
        }
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test-key", "OPENAI_MODEL": "test-model"}):
            with mock.patch.object(backend, "_request", return_value=fake_response) as mock_req:
                result = backend.generate_with_tools(messages, tools)

        self.assertEqual(result.type, "text")
        self.assertIn("BFS", result.content)
        # Verify tools were passed
        payload = mock_req.call_args.args[2]
        self.assertIn("tools", payload)
        self.assertEqual(payload["tool_choice"], "auto")

    def test_generate_with_tools_parses_tool_calls(self) -> None:
        from agent.backends.native import NativeBackend

        backend = NativeBackend()
        messages = [{"role": "user", "content": "查一下动态规划"}]
        tools = get_tool_definitions()

        fake_response = {
            "choices": [{
                "message": {
                    "content": None,
                    "tool_calls": [{
                        "id": "call_abc",
                        "type": "function",
                        "function": {
                            "name": "search_knowledge",
                            "arguments": '{"query": "动态规划"}',
                        },
                    }],
                },
            }],
        }
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test-key", "OPENAI_MODEL": "test-model"}):
            with mock.patch.object(backend, "_request", return_value=fake_response):
                result = backend.generate_with_tools(messages, tools)

        self.assertEqual(result.type, "tool_calls")
        self.assertEqual(len(result.tool_calls), 1)
        self.assertEqual(result.tool_calls[0].name, "search_knowledge")
        self.assertEqual(result.tool_calls[0].arguments, {"query": "动态规划"})


class AgentLoopTests(unittest.TestCase):
    def test_agent_chat_yields_events_without_api_key(self) -> None:
        from agent.agent_loop import agent_chat
        from agent.chat import ChatRequest

        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False), mock.patch(
            "agent.context.retrieve_with_scores", return_value=[]
        ):
            events = list(agent_chat(ChatRequest(message="测试", history=[])))

        event_names = []
        for raw in events:
            text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
            for line in text.split("\n"):
                if line.startswith("event: "):
                    event_names.append(line.removeprefix("event: ").strip())

        self.assertIn("meta", event_names)
        self.assertIn("delta", event_names)
        self.assertIn("done", event_names)

    def test_agent_chat_saves_session(self) -> None:
        from agent.agent_loop import agent_chat
        from agent.chat import ChatRequest

        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False), mock.patch(
            "agent.context.retrieve_with_scores", return_value=[]
        ):
            events = list(agent_chat(ChatRequest(message="测试会话保存", history=[])))

        # Find the done event and verify session_id
        done_found = False
        for raw in events:
            text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
            if "event: done" in text:
                done_found = True
                # There should be a session_id in the data
                self.assertIn("session_id", text)
        self.assertTrue(done_found)


class AgentEndpointTests(unittest.TestCase):
    def test_agent_endpoint_exists(self) -> None:
        from fastapi.testclient import TestClient
        import app as app_module

        client = TestClient(app_module.app)
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False), mock.patch(
            "agent.context.retrieve_with_scores", return_value=[]
        ):
            response = client.post(
                "/api/chat/agent",
                json={"message": "你好", "history": []},
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers.get("content-type", ""))


if __name__ == "__main__":
    unittest.main()
