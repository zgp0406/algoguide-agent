# AlgoGuide Agent

AlgoGuide Agent 是一个面向算法学习场景的 AI 助手原型，基于 FastAPI、轻量级检索层和简洁前端实现。

## 项目能做什么

- 通过网页输入算法问题
- 从本地知识文件中检索相关内容
- 输出结构化回答
- 如果没有配置 API Key，则自动回退到本地兜底回答

## 项目结构

- `app.py`：FastAPI 入口，提供网页和接口
- `agent/chain.py`：对话编排与模型调用
- `agent/retriever.py`：本地知识检索逻辑
- `agent/prompt.py`：回答风格约束
- `knowledge/build_index.py`：构建本地索引
- `static/`：前端页面
- `.vscode/`：VS Code 工作区配置

## 如何运行

1. 创建虚拟环境：

```powershell
python -m venv .venv
```

2. 激活虚拟环境：

```powershell
.\.venv\Scripts\Activate.ps1
```

3. 安装依赖：

```bash
pip install -r requirements.txt
```

4. 构建本地知识索引：

```bash
python knowledge/build_index.py
```

5. 启动服务：

```bash
uvicorn app:app --reload
```

6. 打开浏览器访问：

```text
http://127.0.0.1:8000
```

## 可选配置

如果你配置了环境变量 `OPENAI_API_KEY`，项目会优先调用模型生成回答。
当前实现会直接用标准库请求 OpenAI 兼容接口，不依赖 `openai` SDK，也会忽略系统代理变量。
页面上的“已准备好”只表示配置已就绪，不会在加载时额外发送探测请求。

推荐在项目根目录新建 `.env`：

OpenAI 官方接口示例：

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_TIMEOUT_SECONDS=60
```

如果你要接入 GLM 5.1，可以这样写：

```bash
OPENAI_API_KEY=你的GLM_API_KEY
OPENAI_MODEL=glm-5.1
OPENAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
OPENAI_TIMEOUT_SECONDS=60
```

说明：

- `OPENAI_API_KEY` 填你在智谱控制台拿到的 key
- `OPENAI_MODEL` 填你账号可用的模型名，示例是 `glm-5.1`
- `OPENAI_BASE_URL` 是 OpenAI 兼容接口地址
- `OPENAI_TIMEOUT_SECONDS` 是单次请求等待上限，网络慢时可以调大

## 为什么还要加本地知识库

这个项目不是纯聊天机器人，而是一个“API + 本地知识库”的算法助手原型。加入本地知识库主要有四个目的：

- 让回答更贴合这个项目的算法学习场景
- 先检索本地笔记，再让模型基于资料回答，减少胡说
- 让你可以自己控制内容来源，比如动态规划模板、题解模板、常见算法笔记
- 在 API 不可用时，仍然保留一个本地兜底回答

如果你后续只想做纯聊天，也可以把本地检索那一层去掉，直接把用户问题发给 API。

## 会话记录

当前版本会把聊天会话保存在本地 `data/sessions.json`，并在左侧 `Recent chats` 里显示真实会话列表。

- 新消息会自动追加到当前会话
- 刷新页面后可以继续看到历史会话
- 点击左侧会话可以重新打开对应对话

如果你想清空所有历史记录，直接删除 `data/sessions.json` 即可。

## VS Code 使用方式

直接用 VS Code 打开项目根目录 `algoguide-agent`，然后可以：

- 按 `F5` 运行后端
- 通过任务菜单执行 `Build knowledge index`
- 通过任务菜单执行 `Run server`

## 当前版本说明

这是一个可运行的 MVP 版本，后续可以继续升级为更完整的 RAG/FAISS 方案。

如果 PowerShell 提示脚本执行策略限制，可以先运行：

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

推荐下一步优化：

- 用 FAISS 或其他向量库替换当前的轻量检索
- 在前端展示更清晰的来源引用
- 持久化会话记录
- 按题型细分回答模板

## 名词解释

- **Agent**：可以理解为“会调用工具的智能助手”，不只是聊天，还会根据任务去检索、组织和执行步骤。
- **RAG**：Retrieval-Augmented Generation，中文常叫“检索增强生成”。先检索资料，再让模型基于资料回答，减少胡说和空答。
- **轻量索引**：当前项目里的简化检索方式。先把文档切成小块，再用关键词重叠找相关内容，适合先把 MVP 跑通。
- **向量索引**：把文本转成向量后做相似度检索，语义匹配能力更强，常用于正式 RAG 系统。
- **FAISS**：一种常用的向量检索库，适合做高性能相似度搜索。后续可以用它替换当前的轻量索引。
- **API Key**：调用外部大模型服务时用的密钥。配置后，项目就可以把问题发给模型生成回答。
- **Prompt**：给模型的提示词或指令，用来控制回答风格、格式和内容边界。
- **多轮对话**：不是只回答单个问题，而是能记住上下文，继续追问上一个问题。
