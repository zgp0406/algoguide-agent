import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeArtifactToolPath = pathToFileURL(
  "C:\\Users\\86150\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\@oai\\artifact-tool\\dist\\artifact_tool.mjs",
).href;

const { Presentation, PresentationFile } = await import(runtimeArtifactToolPath);

const W = 1920;
const H = 1080;

const BG = "#F6F1E7";
const INK = "#10211F";
const MUTED = "#66716C";
const GREEN = "#1A8E72";
const GREEN_DARK = "#145D4E";
const GREEN_SOFT = "#EAF8F2";
const ORANGE = "#E09A53";
const ORANGE_SOFT = "#FAE8D8";
const LINE = "#DCD3C6";
const CARD = "#FFFFFF";
const CARD_ALT = "#F8F5EE";
const DARK = "#111B1A";
const DARK_2 = "#182523";
const DARK_3 = "#22322F";
const CODE = "Consolas";
const FONT = "Microsoft YaHei";

const OUT_DIR = path.resolve("output");
const SCRATCH_DIR = path.resolve("scratch");
const PNG_DIR = path.join(SCRATCH_DIR, "slides");
const LAYOUT_DIR = path.join(SCRATCH_DIR, "layouts");

function solid(color) {
  return { type: "solid", color };
}

function px(value) {
  return Math.round(value);
}

function addShape(slide, opts) {
  const shape = slide.shapes.add({ geometry: opts.geometry || "rect" });
  shape.frame = { left: px(opts.x), top: px(opts.y), width: px(opts.w), height: px(opts.h) };
  if (opts.fill) shape.fill = typeof opts.fill === "string" ? solid(opts.fill) : opts.fill;
  if (opts.line) shape.line = opts.line;
  return shape;
}

function addText(slide, opts) {
  const shape = slide.shapes.add({ geometry: opts.geometry || "rect" });
  shape.frame = { left: px(opts.x), top: px(opts.y), width: px(opts.w), height: px(opts.h) };
  shape.text = opts.text;
  shape.text.style = {
    fontSize: opts.size || 24,
    color: opts.color || INK,
    bold: Boolean(opts.bold),
    italic: Boolean(opts.italic),
    alignment: opts.align || "left",
    verticalAlignment: opts.valign || "top",
    typeface: opts.font || FONT,
  };
  return shape;
}

function addPanel(slide, { x, y, w, h, fill = CARD, line = LINE, geometry = "roundRect" }) {
  return addShape(slide, {
    x,
    y,
    w,
    h,
    geometry,
    fill,
    line: { style: "solid", fill: line, width: 1 },
  });
}

function addPill(slide, { x, y, w, h = 44, text, fill = GREEN_SOFT, color = GREEN_DARK, border = "#C8E7D9", size = 16 }) {
  addShape(slide, {
    x,
    y,
    w,
    h,
    geometry: "roundRect",
    fill,
    line: { style: "solid", fill: border, width: 1 },
  });
  addText(slide, {
    x,
    y: y + 2,
    w,
    h: h - 4,
    text,
    size,
    color,
    bold: true,
    align: "center",
    valign: "middle",
  });
}

function addHeader(slide, { section, title, subtitle }) {
  addText(slide, {
    x: 96,
    y: 74,
    w: 520,
    h: 26,
    text: section,
    size: 15,
    color: GREEN,
    bold: true,
    font: CODE,
  });
  addText(slide, {
    x: 96,
    y: 108,
    w: 1280,
    h: 100,
    text: title,
    size: 42,
    color: INK,
    bold: true,
  });
  if (subtitle) {
    addText(slide, {
      x: 96,
      y: 214,
      w: 1380,
      h: 60,
      text: subtitle,
      size: 20,
      color: MUTED,
    });
  }
}

async function saveExport(exported, filePath) {
  if (exported && typeof exported.save === "function") {
    await exported.save(filePath);
    return;
  }
  if (exported && typeof exported.arrayBuffer === "function") {
    await fs.writeFile(filePath, Buffer.from(await exported.arrayBuffer()));
    return;
  }
  if (exported && exported.data) {
    const bytes = exported.data instanceof Uint8Array ? exported.data : new Uint8Array(exported.data);
    await fs.writeFile(filePath, Buffer.from(bytes));
    return;
  }
  throw new TypeError(`Unsupported export object for ${filePath}`);
}

function addUiMockup(slide, x, y, w, h) {
  addPanel(slide, { x, y, w, h, fill: DARK, line: "#2B433D" });

  addShape(slide, {
    x: x + 28,
    y: y + 28,
    w: w - 56,
    h: 40,
    geometry: "roundRect",
    fill: "#1A2724",
    line: { style: "solid", fill: "#27413A", width: 1 },
  });
  addText(slide, {
    x: x + 52,
    y: y + 37,
    w: 250,
    h: 18,
    text: "AlgoGuide Agent",
    size: 16,
    color: "#CDE8DD",
    bold: true,
  });
  addPill(slide, {
    x: x + w - 124,
    y: y + 34,
    w: 96,
    h: 24,
    text: "已就绪",
    fill: GREEN,
    color: "#FFFFFF",
    border: GREEN,
    size: 13,
  });

  addPanel(slide, { x: x + 26, y: y + 84, w: 250, h: h - 112, fill: DARK_2, line: "#2D413B" });
  addText(slide, {
    x: x + 52,
    y: y + 108,
    w: 150,
    h: 18,
    text: "Recent chats",
    size: 13,
    color: "#7FA192",
    bold: true,
    font: CODE,
  });
  const chatItems = [
    ["动态规划入门", "今天 10:22", true],
    ["图论 BFS/DFS", "今天 09:41", false],
  ];
  chatItems.forEach((item, idx) => {
    const yy = y + 150 + idx * 116;
    addPanel(slide, {
      x: x + 50,
      y: yy,
      w: 204,
      h: 90,
      fill: item[2] ? "#213730" : "#182520",
      line: item[2] ? "#3A6157" : "#22322D",
    });
    addShape(slide, {
      x: x + 68,
      y: yy + 18,
      w: 12,
      h: 12,
      geometry: "ellipse",
      fill: item[2] ? GREEN : "#6A7D76",
    });
    addText(slide, {
      x: x + 92,
      y: yy + 10,
      w: 130,
      h: 22,
      text: item[0],
      size: 16,
      color: "#F2F7F4",
      bold: true,
    });
    addText(slide, {
      x: x + 92,
      y: yy + 38,
      w: 118,
      h: 18,
      text: item[1],
      size: 12,
      color: "#8BA29A",
      font: CODE,
    });
  });

  addText(slide, {
    x: x + 52,
    y: y + 390,
    w: 120,
    h: 18,
    text: "Shortcuts",
    size: 13,
    color: "#7FA192",
    bold: true,
    font: CODE,
  });
  ["C++ 动态规划例题", "把答案讲简单一点"].forEach((txt, idx) => {
    const yy = y + 426 + idx * 86;
    addPanel(slide, { x: x + 50, y: yy, w: 204, h: 66, fill: "#182520", line: "#22322D" });
    addText(slide, {
      x: x + 66,
      y: yy + 12,
      w: 170,
      h: 36,
      text: txt,
      size: 13,
      color: "#E6EFEA",
    });
  });

  addPanel(slide, { x: x + 304, y: y + 84, w: w - 330, h: h - 112, fill: "#0D1715", line: "#233631" });
  addText(slide, {
    x: x + 330,
    y: y + 108,
    w: 300,
    h: 18,
    text: "Chat / 检索 / 保存",
    size: 13,
    color: "#91AC9F",
    font: CODE,
  });
  addText(slide, {
    x: x + 330,
    y: y + 140,
    w: 220,
    h: 26,
    text: "算法学习助手",
    size: 22,
    color: "#F1F7F4",
    bold: true,
  });
  addText(slide, {
    x: x + 330,
    y: y + 176,
    w: 330,
    h: 20,
    text: "面向真实答辩场景的对话页面",
    size: 15,
    color: "#A7BFB1",
  });
  addPill(slide, {
    x: x + w - 160,
    y: y + 100,
    w: 54,
    h: 24,
    text: "SSE",
    fill: ORANGE_SOFT,
    color: ORANGE,
    border: "#F2D0B0",
    size: 12,
  });
  addPanel(slide, { x: x + 330, y: y + 220, w: 380, h: 44, fill: "#162421", line: "#263833" });
  addText(slide, {
    x: x + 352,
    y: y + 232,
    w: 300,
    h: 18,
    text: "知识库：本地算法知识库 · RAG 已启用",
    size: 13,
    color: "#B7D2C4",
    font: CODE,
  });
  addPanel(slide, { x: x + 330, y: y + 286, w: 340, h: 118, fill: "#1A2724", line: "#2A3C36" });
  addText(slide, {
    x: x + 350,
    y: y + 304,
    w: 300,
    h: 78,
    text: "我想复习一下动态规划，\n最好能给我一个能直接上手的题目。",
    size: 20,
    color: "#FFFFFF",
  });
  addPanel(slide, { x: x + 390, y: y + 438, w: 386, h: 166, fill: GREEN, line: GREEN });
  addText(slide, {
    x: x + 412,
    y: y + 458,
    w: 340,
    h: 120,
    text: "会先检索本地知识库，\n如果命中，就把相关片段拼进 prompt。\n如果模型不可用，也会回退到本地回答。",
    size: 19,
    color: "#FFFFFF",
  });
  ["本地检索", "流式输出", "自动保存"].forEach((txt, idx) => {
    addPill(slide, {
      x: x + 330 + idx * 132,
      y: y + 626,
      w: idx === 2 ? 126 : 120,
      h: 32,
      text: txt,
      fill: idx === 0 ? GREEN_SOFT : idx === 1 ? "#E7F0EC" : "#F3EBDD",
      color: idx === 0 ? GREEN_DARK : INK,
      border: idx === 0 ? "#BFE1D2" : idx === 1 ? "#D3DED9" : "#E1D6C5",
      size: 14,
    });
  });
  addPanel(slide, { x: x + 330, y: y + 674, w: 430, h: 72, fill: "#162521", line: "#2D413B" });
  addText(slide, {
    x: x + 352,
    y: y + 692,
    w: 290,
    h: 20,
    text: "Message AlgoGuide...",
    size: 18,
    color: "#6C857D",
    italic: true,
    font: CODE,
  });
  addPill(slide, {
    x: x + 704,
    y: y + 688,
    w: 30,
    h: 30,
    text: "→",
    fill: GREEN,
    color: "#FFFFFF",
    border: GREEN,
    size: 16,
  });
}

function cover(slide) {
  slide.background.fill = solid(BG);
  addShape(slide, { x: 1460, y: -120, w: 500, h: 500, geometry: "ellipse", fill: "#E7F2EB" });
  addShape(slide, { x: -170, y: 840, w: 460, h: 280, geometry: "ellipse", fill: "#F0E3D1" });

  addPill(slide, {
    x: 64,
    y: 58,
    w: 180,
    text: "毕业设计答辩",
    fill: GREEN_SOFT,
    color: GREEN_DARK,
    border: "#CBE9DD",
    size: 16,
  });
  addText(slide, {
    x: 96,
    y: 140,
    w: 780,
    h: 132,
    text: "AlgoGuide Agent",
    size: 68,
    color: INK,
    bold: true,
  });
  addText(slide, {
    x: 96,
    y: 274,
    w: 640,
    h: 96,
    text: "面向算法学习场景的 AI 助手原型\n把提问、检索、生成和保存会话串成一条完整链路",
    size: 26,
    color: MUTED,
  });
  addPill(slide, { x: 96, y: 422, w: 132, text: "语义检索" });
  addPill(slide, { x: 244, y: 422, w: 132, text: "流式回答", fill: "#F3EBDD", color: INK, border: "#E0D6C5" });
  addPill(slide, { x: 392, y: 422, w: 132, text: "会话保存" });
  addText(slide, {
    x: 96,
    y: 516,
    w: 520,
    h: 72,
    text: "一个可跑通的算法学习助手 MVP。\n适合简历展示，也适合答辩演示。",
    size: 20,
    color: MUTED,
  });

  addUiMockup(slide, 878, 106, 882, 836);
  addText(slide, {
    x: 96,
    y: 986,
    w: 400,
    h: 18,
    text: "AlgoGuide Agent · 答辩展示版",
    size: 13,
    color: "#8A958F",
    font: CODE,
  });
}

function problem(slide) {
  slide.background.fill = solid(BG);
  addHeader(slide, {
    section: "01 / 背景",
    title: "算法问答的难点，\n不在“回答”，而在“持续回答得对”",
    subtitle: "算法学习不是一次性问答，用户会不断追问、补问和换个角度问，所以系统必须把检索、生成、历史和兜底放在一起。",
  });

  addText(slide, { x: 96, y: 360, w: 300, h: 24, text: "三个真实痛点", size: 15, color: GREEN, bold: true, font: CODE });
  const pains = [
    "问题表达常常是口语化的，\n仅靠关键词命中不够准。",
    "追问时如果丢上下文，\n答案就会开始跑偏。",
    "模型接口不稳定时，\n页面不能直接失效。",
  ];
  pains.forEach((text, i) => {
    const y = 408 + i * 132;
    addPanel(slide, { x: 96, y, w: 780, h: 108, fill: CARD, line: LINE });
    addShape(slide, {
      x: 122,
      y: y + 28,
      w: 46,
      h: 46,
      geometry: "ellipse",
      fill: i === 0 ? GREEN_SOFT : i === 1 ? "#F0E7DA" : ORANGE_SOFT,
    });
    addText(slide, {
      x: 122,
      y: y + 34,
      w: 46,
      h: 24,
      text: String(i + 1),
      size: 20,
      color: i === 2 ? ORANGE : GREEN_DARK,
      bold: true,
      align: "center",
      valign: "middle",
    });
    addText(slide, { x: 188, y: y + 22, w: 640, h: 64, text, size: 22, color: INK, bold: true });
  });

  addPanel(slide, { x: 980, y: 348, w: 844, h: 468, fill: "#11201D", line: "#2A413B" });
  addText(slide, {
    x: 1012,
    y: 378,
    w: 220,
    h: 22,
    text: "项目目标",
    size: 16,
    color: "#A9C7BB",
    bold: true,
    font: CODE,
  });
  addText(slide, {
    x: 1012,
    y: 418,
    w: 724,
    h: 96,
    text: "把“能答”变成“能持续答对”。\n让系统在算法学习场景里同时具备检索准确性、对话连续性和服务稳定性。",
    size: 26,
    color: "#FFFFFF",
    bold: true,
  });
  addShape(slide, { x: 1012, y: 544, w: 704, h: 2, fill: "#2C4A43" });
  addPill(slide, { x: 1012, y: 572, w: 128, text: "检索更准", fill: GREEN, color: "#FFF", border: GREEN });
  addPill(slide, { x: 1154, y: 572, w: 128, text: "回答更顺", fill: "#E4EFE9", color: INK, border: "#C9DDD5" });
  addPill(slide, { x: 1296, y: 572, w: 128, text: "系统更稳", fill: ORANGE_SOFT, color: ORANGE, border: "#E7C7A9" });
  addText(slide, {
    x: 1012,
    y: 650,
    w: 704,
    h: 96,
    text: "所以我没有只做一个聊天页面，而是把“提问 - 检索 - 生成 - 保存会话”整条链路一起做出来。",
    size: 24,
    color: "#D7E7E0",
    bold: true,
  });
}

function flow(slide) {
  slide.background.fill = solid(BG);
  addHeader(slide, {
    section: "02 / 方案",
    title: "一条完整链路：\n先检索，再生成，最后保存",
    subtitle: "如果只做聊天，项目会很像一个空壳；把检索、流式生成和会话保存连起来，才有“助手”的完整感。",
  });

  const steps = [
    ["1", "用户提问", "在网页中输入自然语言问题。"],
    ["2", "本地知识检索", "优先从算法知识库里找相关片段。"],
    ["3", "模型生成", "把检索结果拼进 prompt 再发给模型。"],
    ["4", "会话保存", "把本轮对话写回 SQLite 并刷新侧栏。"],
  ];

  steps.forEach((step, i) => {
    const x = 96 + i * 436;
    addPanel(slide, { x, y: 400, w: 360, h: 164, fill: i % 2 === 0 ? CARD : CARD_ALT, line: LINE });
    addShape(slide, { x: x + 22, y: 22 + 400, w: 8, h: 46, fill: i === 1 ? GREEN : i === 2 ? ORANGE : "#5A6D64" });
    addShape(slide, {
      x: x + 24,
      y: 424,
      w: 42,
      h: 42,
      geometry: "ellipse",
      fill: i === 2 ? ORANGE : GREEN,
    });
    addText(slide, {
      x: x + 24,
      y: 430,
      w: 42,
      h: 24,
      text: step[0],
      size: 20,
      color: "#FFFFFF",
      bold: true,
      align: "center",
      valign: "middle",
      font: CODE,
    });
    addText(slide, { x: x + 82, y: 420, w: 230, h: 28, text: step[1], size: 22, color: INK, bold: true });
    addText(slide, { x: x + 24, y: 474, w: 300, h: 50, text: step[2], size: 18, color: MUTED });
    if (i < steps.length - 1) {
      addShape(slide, { x: x + 360, y: 482, w: 28, h: 4, fill: GREEN });
      addShape(slide, { x: x + 380, y: 474, w: 22, h: 20, geometry: "rightArrow", fill: GREEN });
    }
  });

  addPanel(slide, { x: 96, y: 652, w: 1728, h: 182, fill: CARD, line: LINE });
  addText(slide, {
    x: 124,
    y: 680,
    w: 240,
    h: 22,
    text: "链路里的关键点",
    size: 15,
    color: GREEN,
    bold: true,
    font: CODE,
  });
  addText(slide, {
    x: 124,
    y: 718,
    w: 1480,
    h: 74,
    text: "检索优先，生成兜底。先让系统知道应该看什么，再让模型负责把话说清楚，最后让会话真的能持续聊下去。",
    size: 26,
    color: INK,
    bold: true,
  });
  ["先检索", "再生成", "再保存"].forEach((txt, idx) => {
    addPill(slide, {
      x: 124 + idx * 120,
      y: 796,
      w: 96,
      h: 34,
      text: txt,
      fill: idx === 1 ? "#F3EBDD" : GREEN_SOFT,
      color: idx === 1 ? INK : GREEN_DARK,
      border: idx === 1 ? "#E0D6C5" : "#C8E7D9",
      size: 14,
    });
  });
}

function features(slide) {
  slide.background.fill = solid(BG);
  addHeader(slide, {
    section: "03 / 功能",
    title: "功能设计围绕学习体验来拼，\n而不是围绕页面模块来堆",
    subtitle: "每个功能都服务于同一个目标：让算法学习这件事更像一个连续的对话过程。",
  });

  const cards = [
    ["支持快捷问题填充", "侧边栏直接放入 C++ 例题、简化解释、继续追问等入口。", GREEN],
    ["支持流式输出", "回答可以边生成边展示，交互体验更像真实聊天。", ORANGE],
    ["支持本地会话保存", "刷新后还能看见历史会话，侧栏会显示最近记录和摘要。", "#3F7B6B"],
    ["支持本地知识检索 + 兜底", "先切块做语义检索；如果模型不可用，仍能给出可用答案。", "#5A6D64"],
  ];
  cards.forEach((c, i) => {
    const x = i % 2 === 0 ? 96 : 1044;
    const y = i < 2 ? 352 : 548;
    addPanel(slide, { x, y, w: 780, h: 158, fill: CARD, line: LINE });
    addShape(slide, { x: x + 22, y: y + 24, w: 10, h: 44, fill: c[2] });
    addText(slide, { x: x + 46, y: y + 20, w: 680, h: 30, text: c[0], size: 23, color: INK, bold: true });
    addText(slide, { x: x + 46, y: y + 58, w: 680, h: 58, text: c[1], size: 18, color: MUTED });
  });

  addPanel(slide, { x: 96, y: 764, w: 1728, h: 166, fill: "#11221F", line: "#29423B" });
  addText(slide, {
    x: 124,
    y: 792,
    w: 220,
    h: 20,
    text: "最终效果",
    size: 15,
    color: "#9CCAB9",
    bold: true,
    font: CODE,
  });
  addText(slide, {
    x: 124,
    y: 828,
    w: 1500,
    h: 72,
    text: "不是一个孤立的聊天框，而是一个能“问 - 查 - 答 - 存 - 续问”的算法学习工作台。",
    size: 28,
    color: "#FFFFFF",
    bold: true,
  });
}

function architecture(slide) {
  slide.background.fill = solid(BG);
  addHeader(slide, {
    section: "04 / 架构",
    title: "前端、编排层、知识层，\n各自只做一件事",
    subtitle: "把职责拆开后，代码更清楚，排查问题也更快。FastAPI 管接口，retriever 管检索，sessions 管持久化。",
  });

  const rows = [
    ["前端", "static/", "聊天界面、快捷问题、会话列表、流式消息渲染", ORANGE],
    ["编排层", "app.py + agent/chain.py", "FastAPI 接口、模型调用、SSE 流、状态检查、消息拼装", GREEN],
    ["知识与存储", "retriever.py + sessions.py", "Sentence Transformers、FAISS、SQLite、旧 JSON 导入", "#3E7568"],
  ];

  rows.forEach((row, i) => {
    const y = 356 + i * 170;
    addPanel(slide, { x: 96, y, w: 1120, h: 136, fill: i === 0 ? "#FFF7EC" : i === 1 ? "#E9F8F2" : "#ECF3EF", line: LINE });
    addShape(slide, {
      x: 122,
      y: y + 30,
      w: 88,
      h: 72,
      geometry: "roundRect",
      fill: row[3],
    });
    addText(slide, {
      x: 122,
      y: y + 48,
      w: 88,
      h: 26,
      text: row[0],
      size: 18,
      color: "#FFFFFF",
      bold: true,
      align: "center",
      valign: "middle",
      font: CODE,
    });
    addText(slide, { x: 248, y: y + 24, w: 470, h: 28, text: row[1], size: 22, color: INK, bold: true, font: CODE });
    addText(slide, { x: 248, y: y + 62, w: 790, h: 42, text: row[2], size: 19, color: MUTED });
  });

  addPanel(slide, { x: 1296, y: 356, w: 528, h: 476, fill: DARK, line: "#2A413B" });
  addText(slide, {
    x: 1324,
    y: 386,
    w: 220,
    h: 20,
    text: "模块边界",
    size: 15,
    color: "#A9C7BB",
    bold: true,
    font: CODE,
  });
  addText(slide, {
    x: 1324,
    y: 420,
    w: 420,
    h: 70,
    text: "FastAPI / SSE / status / sessions",
    size: 24,
    color: "#F2F7F4",
    bold: true,
  });
  ["前端只负责呈现", "编排层只负责调用链", "知识层只负责找内容"].forEach((txt, i) => {
    addPanel(slide, {
      x: 1324,
      y: 520 + i * 96,
      w: 460,
      h: 68,
      fill: "#162421",
      line: "#263833",
    });
    addShape(slide, { x: 1342, y: 537 + i * 96, w: 10, h: 34, fill: i === 1 ? GREEN : i === 2 ? ORANGE : "#5A6D64" });
    addText(slide, { x: 1366, y: 530 + i * 96, w: 380, h: 34, text: txt, size: 20, color: "#EAF4EF", bold: true });
  });
}

function engineering(slide) {
  slide.background.fill = solid(BG);
  addHeader(slide, {
    section: "05 / 亮点",
    title: "我重点处理的 4 个工程细节",
    subtitle: "这些点不是炫技，而是保证这个原型在答辩演示时真能用、用得稳。",
  });

  const metrics = [
    ["8", "最近上下文消息数"],
    ["60s", "模型请求超时时间"],
    ["3000ms", "SQLite 等待时间"],
    ["FAISS", "语义检索索引"],
  ];
  metrics.forEach((m, i) => {
    const x = 96 + i * 288;
    addPanel(slide, { x, y: 332, w: 264, h: 110, fill: CARD, line: LINE });
    addText(slide, { x: x + 22, y: 352, w: 210, h: 32, text: m[0], size: 28, color: INK, bold: true });
    addText(slide, { x: x + 22, y: 388, w: 210, h: 30, text: m[1], size: 15, color: MUTED });
  });

  const notes = [
    ["语义检索", "先切块，再编码成向量，最后用 FAISS 做相似度搜索。", GREEN],
    ["流式输出", "/api/chat/stream 通过 SSE 把回答逐段返回。", ORANGE],
    ["兜底机制", "外部模型失败或超时，系统自动退回本地回答。", "#3F7B6B"],
  ];
  notes.forEach((n, i) => {
    const y = 486 + i * 126;
    addPanel(slide, { x: 96, y, w: 1180, h: 104, fill: CARD, line: LINE });
    addShape(slide, { x: 122, y: y + 24, w: 54, h: 54, geometry: "ellipse", fill: n[2] });
    addText(slide, {
      x: 122,
      y: y + 31,
      w: 54,
      h: 24,
      text: String(i + 1),
      size: 22,
      color: "#FFFFFF",
      bold: true,
      align: "center",
      valign: "middle",
      font: CODE,
    });
    addText(slide, { x: 198, y: y + 18, w: 220, h: 26, text: n[0], size: 23, color: INK, bold: true });
    addText(slide, { x: 198, y: y + 50, w: 960, h: 28, text: n[1], size: 18, color: MUTED });
  });

  addPanel(slide, { x: 1314, y: 486, w: 510, h: 430, fill: DARK, line: "#29423B" });
  addText(slide, {
    x: 1340,
    y: 514,
    w: 220,
    h: 20,
    text: "稳定性优化",
    size: 15,
    color: "#9CCAB9",
    bold: true,
    font: CODE,
  });
  addText(slide, {
    x: 1340,
    y: 548,
    w: 430,
    h: 126,
    text: "前端加单请求锁，后端给 SQLite busy_timeout，并保留旧 JSON 的自动导入逻辑。",
    size: 23,
    color: "#FFFFFF",
    bold: true,
  });
  ["请求锁", "busy_timeout", "旧数据导入"].forEach((txt, i) => {
    addPill(slide, {
      x: 1340 + i * 132,
      y: 710,
      w: i === 1 ? 110 : 96,
      h: 34,
      text: txt,
      fill: i === 1 ? "#F3EBDD" : GREEN_SOFT,
      color: i === 1 ? INK : GREEN_DARK,
      border: i === 1 ? "#E0D6C5" : "#C8E7D9",
      size: 14,
    });
  });
  addText(slide, {
    x: 1340,
    y: 770,
    w: 420,
    h: 92,
    text: "答辩时我会强调：这里追求的是“真能用、用得稳”，而不是只把 demo 做得好看。",
    size: 22,
    color: "#D7E7E0",
    bold: true,
  });
}

function closing(slide) {
  slide.background.fill = solid(BG);
  addHeader(slide, {
    section: "06 / 演示与收束",
    title: "答辩时我会这样演示",
    subtitle: "先把流程跑通，再把工程细节讲明白，最后落到这个项目到底解决了什么问题。",
  });

  const steps = [
    ["1", "输入一个算法问题", "比如动态规划、图论或前缀和。"],
    ["2", "侧栏选一个历史会话", "刷新后依然能续聊，历史不会丢。"],
    ["3", "观察流式返回", "能看到生成过程和知识库命中状态。"],
    ["4", "追问并切换话题", "验证上下文和兜底逻辑是否正常。"],
  ];
  steps.forEach((s, i) => {
    const x = 96 + i * 420;
    addPanel(slide, { x, y: 348, w: 360, h: 208, fill: i % 2 === 0 ? CARD : CARD_ALT, line: LINE });
    addShape(slide, { x: x + 24, y: 374, w: 52, h: 52, geometry: "ellipse", fill: i === 2 ? ORANGE : GREEN });
    addText(slide, {
      x: x + 24,
      y: 382,
      w: 52,
      h: 24,
      text: s[0],
      size: 22,
      color: "#FFFFFF",
      bold: true,
      align: "center",
      valign: "middle",
      font: CODE,
    });
    addText(slide, { x: x + 96, y: 376, w: 230, h: 54, text: s[1], size: 22, color: INK, bold: true });
    addText(slide, { x: x + 24, y: 454, w: 308, h: 74, text: s[2], size: 18, color: MUTED });
  });

  addPanel(slide, { x: 96, y: 612, w: 1140, h: 278, fill: "#11211E", line: "#28423B" });
  addText(slide, {
    x: 124,
    y: 640,
    w: 220,
    h: 20,
    text: "可以继续扩展的方向",
    size: 15,
    color: "#9FC8B9",
    bold: true,
    font: CODE,
  });
  ["多知识库切换", "更长的长期记忆", "检索效果评估", "权限与日志审计"].forEach((txt, i) => {
    addPill(slide, {
      x: 124 + i * 244,
      y: 690,
      w: 210,
      h: 42,
      text: txt,
      fill: i % 2 === 0 ? "#E2F0E8" : "#F5E7D6",
      color: i % 2 === 0 ? GREEN_DARK : INK,
      border: i % 2 === 0 ? "#C2DCD0" : "#E6D3BC",
      size: 17,
    });
  });
  addText(slide, {
    x: 124,
    y: 770,
    w: 980,
    h: 82,
    text: "当前版本已经把最核心的“问 - 查 - 答 - 存”闭环跑通，后续就是把它做得更准、更稳、更可扩展。",
    size: 23,
    color: "#D7E9E2",
    bold: true,
  });

  addPanel(slide, { x: 1270, y: 612, w: 554, h: 278, fill: CARD, line: LINE });
  addText(slide, {
    x: 1298,
    y: 640,
    w: 220,
    h: 20,
    text: "答辩收束句",
    size: 15,
    color: GREEN,
    bold: true,
    font: CODE,
  });
  addText(slide, {
    x: 1298,
    y: 682,
    w: 476,
    h: 128,
    text: "AlgoGuide Agent 已经不是单纯的聊天页面，而是一个面向算法学习场景、具备检索、生成、保存和兜底能力的完整原型。",
    size: 28,
    color: INK,
    bold: true,
  });
}

const presentation = Presentation.create({ slideSize: { width: W, height: H } });
const builders = [cover, problem, flow, features, architecture, engineering, closing];

const slides = [];
for (const build of builders) {
  const slide = presentation.slides.add();
  build(slide);
  slides.push(slide);
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.mkdir(PNG_DIR, { recursive: true });
await fs.mkdir(LAYOUT_DIR, { recursive: true });

for (let i = 0; i < slides.length; i += 1) {
  const index = String(i + 1).padStart(2, "0");
  await saveExport(await slides[i].export({ format: "png" }), path.join(PNG_DIR, `slide-${index}.png`));
  await saveExport(await slides[i].export({ format: "layout" }), path.join(LAYOUT_DIR, `slide-${index}.json`));
}

await saveExport(await PresentationFile.exportPptx(presentation), path.join(OUT_DIR, "output.pptx"));

console.log(
  JSON.stringify(
    {
      pptx: path.join(OUT_DIR, "output.pptx"),
      previews: slides.map((_, i) => path.join(PNG_DIR, `slide-${String(i + 1).padStart(2, "0")}.png`)),
      layouts: slides.map((_, i) => path.join(LAYOUT_DIR, `slide-${String(i + 1).padStart(2, "0")}.json`)),
    },
    null,
    2,
  ),
);
