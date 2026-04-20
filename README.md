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

1. 创建虚拟环境。
2. 安装依赖：

```bash
pip install -r requirements.txt
```

3. 构建本地知识索引：

```bash
python knowledge/build_index.py
```

4. 启动服务：

```bash
uvicorn app:app --reload
```

5. 打开浏览器访问：

```text
http://127.0.0.1:8000
```

## 可选配置

如果你配置了环境变量 `OPENAI_API_KEY`，项目会优先调用模型生成回答。

可选再指定：

```bash
OPENAI_MODEL=gpt-4.1-mini
```

## VS Code 使用方式

直接用 VS Code 打开项目根目录 `algoguide-agent`，然后可以：

- 按 `F5` 运行后端
- 通过任务菜单执行 `Build knowledge index`
- 通过任务菜单执行 `Run server`

## 当前版本说明

这是一个可运行的 MVP 版本，后续可以继续升级为更完整的 RAG/FAISS 方案。

推荐下一步优化：

- 用 FAISS 或其他向量库替换当前的轻量检索
- 在前端展示更清晰的来源引用
- 持久化会话记录
- 按题型细分回答模板
