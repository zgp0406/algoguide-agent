# AlgoGuide LangChain 双后端改造方案

## 1. 改造目标

在不替换现有知识库、FAISS 索引和混合检索器的前提下，为 AlgoGuide 增加 LangChain 回答后端，并保留当前原生实现作为基线和回退方案。

改造完成后，通过环境变量选择运行后端：

```env
CHAIN_BACKEND=native
```

或：

```env
CHAIN_BACKEND=langchain
```

正常运行时只调用其中一个后端，不会产生双倍模型请求。只有执行 A/B 评测时，才使用同一问题分别调用两个后端。

## 2. 改造边界

### 2.1 两种方案共用

- 知识文件及解析结果
- 知识块
- embedding 模型
- FAISS 索引
- 语义与词面混合排序
- 每个来源只保留最高分片段
- Top-K 配置
- 低置信度门控
- 来源和证据元数据
- 会话存储
- 遥测和错误分类
- FastAPI 接口与前端

### 2.2 两种方案不同

| 能力 | Native 后端 | LangChain 后端 |
|---|---|---|
| Prompt 构建 | 手工组织消息 | `ChatPromptTemplate` |
| 模型调用 | `urllib` | `ChatOpenAI` |
| 流程编排 | 普通 Python 函数 | LCEL Runnable |
| 输出解析 | 手工读取响应 JSON | `StrOutputParser` |
| 流式输出 | 手工解析并转换 SSE | `astream()` 转换 SSE |
| 扩展工具和 Agent | 手工实现 | 可接 LangChain Tools/LangGraph |

## 3. 目标架构

```text
用户请求
   ↓
FastAPI
   ↓
agent/chain.py
   ├── 会话读取
   ├── 混合检索
   ├── 置信度门控
   ├── 上下文和来源整理
   ↓
agent/backends/factory.py
   ├── NativeBackend
   └── LangChainBackend
   ↓
GLM-5.1 OpenAI 兼容接口
   ↓
统一 GenerationResult
   ↓
会话保存、遥测、ChatResponse
```

检索发生在后端选择之前，因此两个后端收到相同的问题、知识片段和来源。

## 4. 建议代码结构

```text
algoguide-agent/
├── agent/
│   ├── chain.py
│   ├── retriever.py
│   ├── prompt.py
│   ├── sessions.py
│   ├── telemetry.py
│   ├── langchain_retriever.py
│   └── backends/
│       ├── __init__.py
│       ├── base.py
│       ├── native.py
│       ├── langchain.py
│       └── factory.py
├── tests/
│   ├── test_core.py
│   └── test_backends.py
├── evals/
│   ├── eval_questions.jsonl
│   ├── answer_eval_questions.jsonl
│   ├── rag_eval.py
│   └── backend_eval.py
└── requirements.langchain.txt
```

职责划分：

- `chain.py`：统一聊天入口，只处理公共流程。
- `retriever.py`：继续提供当前混合检索。
- `langchain_retriever.py`：把 `RetrievedChunk` 转换成 LangChain `Document`。
- `base.py`：定义两个后端共同的输入和输出协议。
- `native.py`：封装当前 `urllib` 模型调用。
- `langchain.py`：实现 LCEL 生成管道。
- `factory.py`：根据 `CHAIN_BACKEND` 创建后端。
- `backend_eval.py`：对两个后端执行相同问题并输出对比结果。

## 5. 统一后端协议

`agent/backends/base.py`：

```python
from dataclasses import dataclass
from typing import Protocol


@dataclass
class GenerationRequest:
    question: str
    context: str
    history: list[dict[str, str]]


@dataclass
class GenerationResult:
    answer: str
    model: str


class GenerationBackend(Protocol):
    def generate(self, request: GenerationRequest) -> GenerationResult:
        """根据统一输入生成回答。"""
        ...
```

后端不得自行重新检索，以保证 A/B 测试使用完全相同的知识片段。

## 6. Native 后端

`agent/backends/native.py` 负责封装现有逻辑：

```python
class NativeBackend:
    def generate(self, request: GenerationRequest) -> GenerationResult:
        messages = build_native_messages(request)
        answer = request_chat_completion_with_urllib(messages)

        return GenerationResult(
            answer=answer,
            model=configured_model_name(),
        )
```

迁移时应复用现有超时、错误分类和代理处理逻辑，不改变当前外部行为。

## 7. LangChain 后端

建议依赖：

```text
langchain
langchain-core
langchain-openai
```

`agent/backends/langchain.py` 的核心管道：

```python
prompt = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            """你是算法学习助手。
只能依据提供的知识库资料回答。
资料不足时明确说明，不要使用自身知识冒充知识库内容。

知识库资料：
{context}""",
        ),
        ("human", "{question}"),
    ]
)

chain = prompt | model | StrOutputParser()
```

模型继续读取项目现有配置：

```python
model = ChatOpenAI(
    model=os.getenv("OPENAI_MODEL", "glm-5.1"),
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL"),
    temperature=0.2,
)
```

LangChain 后端只负责生成，不重新创建知识库、切片或索引。

## 8. LangChain Retriever 适配器

为了体现对 LangChain Retriever 和 `Document` 的使用，可增加适配器，但底层仍调用现有检索器：

```python
from langchain_core.documents import Document

from agent.retriever import retrieve_with_scores


def retrieve_documents(query: str, k: int = 3) -> list[Document]:
    chunks = retrieve_with_scores(query, k=k)

    return [
        Document(
            page_content=chunk.text,
            metadata={
                "source": chunk.source,
                "location": chunk.location,
                "score": chunk.score,
                "retrieval_mode": chunk.retrieval_mode,
            },
        )
        for chunk in chunks
    ]
```

该适配器用于兼容 LangChain 组件，不改变现有检索排序。

## 9. 后端工厂

`agent/backends/factory.py`：

```python
import os

from agent.backends.native import NativeBackend


def create_backend():
    backend = os.getenv("CHAIN_BACKEND", "native").strip().lower()

    if backend == "langchain":
        # 延迟导入，未安装 LangChain 时不影响 Native 后端。
        from agent.backends.langchain import LangChainBackend

        return LangChainBackend()

    if backend == "native":
        return NativeBackend()

    raise ValueError(f"不支持的 CHAIN_BACKEND：{backend}")
```

使用延迟导入可以避免 Native 模式依赖 LangChain 包。

## 10. 统一聊天流程

`agent/chain.py` 应逐步收敛为公共编排层：

```python
def chat(request: ChatRequest) -> ChatResponse:
    rag_context = build_context(request.message)
    backend = create_backend()

    result = backend.generate(
        GenerationRequest(
            question=request.message,
            context=rag_context.context,
            history=request.history,
        )
    )

    save_session(result.answer)
    log_metrics()
    return build_chat_response(result, rag_context)
```

公共编排层继续负责：

- 检索和门控
- 来源与证据
- 会话保存
- 错误结构
- 遥测数据
- API 返回格式

这样可以避免两个后端重复实现业务逻辑。

## 11. 流式输出

Native 后端继续使用当前流式请求解析。

LangChain 后端使用：

```python
async for chunk in chain.astream(payload):
    yield chunk
```

上层统一把文本块转换为当前项目使用的 SSE 事件：

```text
meta → delta → done
```

两种后端对前端保持相同协议，前端不需要感知当前后端。

## 12. 实施步骤

### 第一阶段：建立接口，不改变行为

1. 新增 `base.py`、`native.py` 和 `factory.py`。
2. 将当前模型请求逻辑移动到 `NativeBackend`。
3. 保持 `CHAIN_BACKEND=native`。
4. 确认现有单元测试和 API 行为不变。

### 第二阶段：增加 LangChain

1. 添加 LangChain 依赖。
2. 增加 `LangChainBackend`。
3. 使用现有 GLM OpenAI 兼容配置。
4. 保持检索、门控、来源和会话逻辑共用。
5. 增加 LangChain 普通回答和流式回答测试。

### 第三阶段：A/B 评测

对同一批固定问题分别执行：

```text
CHAIN_BACKEND=native
CHAIN_BACKEND=langchain
```

保存独立结果，不使用测试集调 Prompt。

### 第四阶段：选择默认后端

- LangChain 有明确收益：将其设为默认，Native 作为回退。
- 两者结果相近：根据代码维护成本和延迟选择。
- LangChain 明显退化：保持 Native 默认，LangChain 作为实验实现。

## 13. 测试方案

### 13.1 单元测试

- Factory 能正确选择后端。
- 未安装 LangChain 时 Native 可以正常加载。
- 两个后端都符合 `GenerationBackend` 协议。
- LangChain Retriever 保留来源、位置、分数和检索模式。
- 没有上下文时不会伪造知识库来源。
- 模型异常能转换为统一错误结构。
- 两种后端流式事件顺序一致。

### 13.2 A/B 指标

| 指标 | 说明 |
|---|---|
| API 成功率 | 是否正常得到模型响应 |
| 必要知识点覆盖率 | 回答是否覆盖标准答案要点 |
| 正确来源命中率 | 是否使用正确资料 |
| 来源精确率 | 返回来源中正确来源的比例 |
| 有证据答案率 | 答案正确且来源正确 |
| 库外 RAG 拒绝率 | 无答案问题是否停用知识库 |
| 库外实际拒答率 | 是否仍用模型自身知识回答 |
| P50/P95 延迟 | 普通回答和流式首字延迟 |
| 输出稳定性 | 重复问题答案是否异常波动 |
| 错误率 | 超时、限流和解析错误 |

检索指标应基本一致，因为两个后端共用同一个检索器。若检索指标不同，应先检查测试过程是否错误。

## 14. 验收标准

- Native 模式现有功能无回归。
- LangChain 模式可以完成普通和流式回答。
- 两种模式返回相同的 API 字段。
- 两种模式使用相同的检索结果和来源。
- `.env` 中的密钥不会出现在日志、异常或测试结果中。
- 现有 24 项单元测试继续通过。
- 新增后端测试全部通过。
- 完成固定测试集 A/B 结果文档。
- 明确记录默认后端及选择依据。

## 15. 不建议同时进行的修改

本阶段不要同时替换：

- 文档解析器
- 切片算法
- embedding 模型
- FAISS 索引结构
- 混合检索权重
- 门控阈值

否则无法判断结果变化来自 LangChain 编排还是检索系统变化。

如果需要比较 LangChain 切片，应单独建立第二套索引并作为独立实验。

## 16. 简历表述

完成实现和评测后可以表述为：

> 基于 LangChain LCEL 构建可切换 RAG 编排层，自定义 Retriever 适配现有 FAISS 语义检索、中文词面重排和来源去重，支持 Native/LangChain 双后端、低置信门控、来源元数据及 SSE 流式输出；建立固定评测集进行 A/B 验证，检索侧实现 Hit@1 90%、Hit@3 90%、MRR 0.90。

不能把当前混合检索指标描述为 LangChain 自动带来的提升。LangChain 在该方案中主要承担模型适配、Prompt 编排、输出解析和后续工具扩展。

## 17. 最终建议

先保留 Native 作为默认后端，完成 LangChain 普通回答、流式输出和 A/B 评测后，再决定是否切换默认值。

推荐初始配置：

```env
CHAIN_BACKEND=native
```

LangChain 验证完成后再考虑：

```env
CHAIN_BACKEND=langchain
```
