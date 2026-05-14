import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeArtifactToolPath = pathToFileURL(
  "C:\\Users\\86150\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\@oai\\artifact-tool\\dist\\artifact_tool.mjs",
).href;

const {
  Presentation,
  PresentationFile,
} = await import(runtimeArtifactToolPath);

const WIDTH = 1920;
const HEIGHT = 1080;
const BG = "#F7F3EA";
const INK = "#10211F";
const INK_2 = "#173430";
const MUTED = "#667570";
const LINE = "#D9D2C6";
const CARD = "#FFFFFF";
const MINT = "#D9F2E9";
const MINT_2 = "#BFE7D7";
const GREEN = "#1A8E72";
const GREEN_DARK = "#145D4E";
const GREEN_SOFT = "#EAF8F2";
const SAND = "#E9E0D1";
const ORANGE = "#E29A52";
const ORANGE_SOFT = "#FAE8D8";
const SLATE = "#EEF1ED";
const DARK = "#111B1A";
const DARK_2 = "#182523";
const DARK_3 = "#22322F";
const SHADOW = "shadow-md";
const FONT = "Microsoft YaHei";
const CODE_FONT = "Consolas";
const OUT_DIR = path.resolve("output");
const SCRATCH_DIR = path.resolve("scratch");
const PNG_DIR = path.join(SCRATCH_DIR, "slides");
const LAYOUT_DIR = path.join(SCRATCH_DIR, "layouts");

function solid(color) {
  return { type: "solid", color };
}

function px(n) {
  return Math.round(n);
}

function addShape(slide, {
  x,
  y,
  w,
  h,
  geometry = "rect",
  fill,
  line,
}) {
  const shape = slide.shapes.add({ geometry });
  shape.frame = { left: px(x), top: px(y), width: px(w), height: px(h) };
  if (fill) shape.fill = typeof fill === "string" ? solid(fill) : fill;
  if (line) shape.line = line;
  return shape;
}

function addText(slide, {
  x,
  y,
  w,
  h,
  text,
  size = 24,
  color = INK,
  bold = false,
  italic = false,
  align = "left",
  valign = "top",
  font = FONT,
  geometry = "rect",
}) {
  const shape = slide.shapes.add({ geometry });
  shape.frame = { left: px(x), top: px(y), width: px(w), height: px(h) };
  shape.text = text;
  shape.text.style = {
    fontSize: size,
    color,
    bold,
    italic,
    alignment: align,
    verticalAlignment: valign,
    typeface: font,
  };
  return shape;
}

function addRule(slide, x, y, w, color = LINE, h = 2) {
  return addShape(slide, { x, y, w, h, fill: color });
}

function addPill(slide, {
  x,
  y,
  w,
  h = 44,
  text,
  fill = MINT,
  color = INK,
  border = fill,
  size = 18,
}) {
  addShape(slide, {
    x,
    y,
    w,
    h,
    geometry: "roundRect",
    fill,
    line: { style: "solid", fill: border, width: 1 },
  });
  return addText(slide, {
    x,
    y: y + 2,
    w,
    h: h - 4,
    text,
    size,
    color,
    align: "center",
    valign: "middle",
  });
}

function addHeader(slide, { section, title, subtitle }) {
  addText(slide, {
    x: 96,
    y: 72,
    w: 760,
    h: 34,
    text: section,
    size: 16,
    color: GREEN,
    bold: true,
    font: CODE_FONT,
  });
  addText(slide, {
    x: 96,
    y: 110,
    w: 1280,
    h: 112,
    text: title,
    size: 42,
    color: INK,
    bold: true,
  });
  if (subtitle) {
    addText(slide, {
      x: 96,
      y: 212,
      w: 1380,
      h: 62,
      text: subtitle,
      size: 20,
      color: MUTED,
    });
  }
}

function addMetricChip(slide, x, y, w, value, label) {
  addShape(slide, {
    x,
    y,
    w,
    h: 112,
    geometry: "roundRect",
    fill: CARD,
    line: { style: "solid", fill: LINE, width: 1 },
    shadow: SHADOW,
  });
  addText(slide, {
    x: x + 22,
    y: y + 18,
    w: w - 44,
    h: 36,
    text: value,
    size: 28,
    color: INK,
    bold: true,
  });
  addText(slide, {
    x: x + 22,
    y: y + 60,
    w: w - 44,
    h: 28,
    text: label,
    size: 15,
    color: MUTED,
  });
}

function addFeatureCard(slide, { x, y, w, h, title, body, accent = GREEN, background = CARD }) {
  addShape(slide, {
    x,
    y,
    w,
    h,
    geometry: "roundRect",
    fill: background,
    line: { style: "solid", fill: LINE, width: 1 },
    shadow: SHADOW,
  });
  addShape(slide, {
    x: x + 22,
    y: y + 22,
    w: 10,
    h: 46,
    fill: accent,
  });
  addText(slide, {
    x: x + 46,
    y: y + 18,
    w: w - 72,
    h: 34,
    text: title,
    size: 23,
    color: INK,
    bold: true,
  });
  addText(slide, {
    x: x + 46,
    y: y + 58,
    w: w - 70,
    h: h - 78,
    text: body,
    size: 18,
    color: MUTED,
  });
}

function addSmallLabel(slide, { x, y, w, text, color = MUTED, size = 14, font = CODE_FONT }) {
  addText(slide, {
    x,
    y,
    w,
    h: 24,
    text,
    size,
    color,
    bold: true,
    font,
  });
}

function addLine(slide, x1, y1, x2, y2, color = LINE, thickness = 2) {
  if (Math.abs(y1 - y2) < 1) {
    return addShape(slide, { x: Math.min(x1, x2), y: y1, w: Math.abs(x2 - x1), h: thickness, fill: color });
  }
  if (Math.abs(x1 - x2) < 1) {
    return addShape(slide, { x: x1, y: Math.min(y1, y2), w: thickness, h: Math.abs(y2 - y1), fill: color });
  }
  const rule = addShape(slide, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: thickness, fill: color });
  rule.position.rotation = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  return rule;
}

function buildCover(slide) {
  slide.background.fill = solid(BG);

  addShape(slide, {
    x: 1365,
    y: -40,
    w: 560,
    h: 560,
    geometry: "ellipse",
    fill: "#E7F2EB",
  });
  addShape(slide, {
    x: -180,
    y: 770,
    w: 560,
    h: 360,
    geometry: "ellipse",
    fill: "#F0E3D1",
  });
  addShape(slide, {
    x: 64,
    y: 58,
    w: 178,
    h: 44,
    geometry: "roundRect",
    fill: GREEN_SOFT,
    line: { style: "solid", fill: "#CBE9DD", width: 1 },
  });
  addText(slide, {
    x: 82,
    y: 66,
    w: 142,
    h: 26,
    text: "毕业设计答辩",
    size: 16,
    color: GREEN_DARK,
    bold: true,
    font: CODE_FONT,
  });

  addText(slide, {
    x: 96,
    y: 138,
    w: 730,
    h: 152,
    text: "AlgoGuide Agent",
    size: 74,
    color: INK,
    bold: true,
  });
  addText(slide, {
    x: 96,
    y: 286,
    w: 690,
    h: 112,
    text: "面向算法学习场景的 AI 助手原型\n把提问、检索、生成和保存会话串成一条完整链路",
    size: 31,
    color: MUTED,
  });

  const chipY = 432;
  const chipW = [126, 126, 126, 126];
  const chipTexts = ["语义检索", "流式回答", "会话保存", "兜底机制"];
  let chipX = 96;
  for (let i = 0; i < chipTexts.length; i += 1) {
    addPill(slide, {
      x: chipX,
      y: chipY,
      w: chipW[i],
      h: 48,
      text: chipTexts[i],
      fill: i % 2 === 0 ? MINT : "#F1E8DA",
      color: i % 2 === 0 ? GREEN_DARK : INK,
      border: i % 2 === 0 ? "#C8E7D9" : "#E0D6C5",
      size: 18,
    });
    chipX += chipW[i] + 16;
  }

  addText(slide, {
    x: 96,
    y: 516,
    w: 580,
    h: 90,
    text: "一个可跑通的算法学习助手 MVP。\n适合简历展示，也适合答辩演示。",
    size: 22,
    color: MUTED,
  });

  addShape(slide, {
    x: 900,
    y: 120,
    w: 860,
    h: 840,
    geometry: "roundRect",
    fill: DARK,
    line: { style: "solid", fill: "#2D453F", width: 1 },
    shadow: { index: "9" },
  });
  addShape(slide, {
    x: 930,
    y: 150,
    w: 800,
    h: 36,
    geometry: "roundRect",
    fill: "#1A2724",
    line: { style: "solid", fill: "#27413A", width: 1 },
  });
  addText(slide, {
    x: 954,
    y: 156,
    w: 220,
    h: 22,
    text: "AlgoGuide Agent",
    size: 16,
    color: "#CDE8DD",
    bold: true,
  });
  addPill(slide, {
    x: 1616,
    y: 151,
    w: 96,
    h: 30,
    text: "已就绪",
    fill: GREEN,
    color: "#FFFFFF",
    border: GREEN,
    size: 14,
  });

  addShape(slide, {
    x: 930,
    y: 196,
    w: 250,
    h: 730,
    geometry: "roundRect",
    fill: DARK_2,
    line: { style: "solid", fill: "#293933", width: 1 },
  });
  addText(slide, {
    x: 956,
    y: 220,
    w: 170,
    h: 24,
    text: "Recent chats",
    size: 14,
    color: "#7FA192",
    bold: true,
    font: CODE_FONT,
  });

  const sessions = [
    { t: "动态规划入门", s: "今天 10:22" },
    { t: "图论 BFS/DFS", s: "今天 09:41" },
    { t: "前缀和例题", s: "昨天 21:06" },
  ];
  sessions.forEach((item, idx) => {
    const y = 262 + idx * 112;
    addShape(slide, {
      x: 952,
      y,
      w: 204,
      h: 92,
      geometry: "roundRect",
      fill: idx === 0 ? "#213730" : "#182520",
      line: { style: "solid", fill: idx === 0 ? "#3A6157" : "#22322D", width: 1 },
    });
    addShape(slide, {
      x: 969,
      y: y + 16,
      w: 12,
      h: 12,
      geometry: "ellipse",
      fill: idx === 0 ? GREEN : "#6A7D76",
    });
    addText(slide, {
      x: 992,
      y: y + 10,
      w: 134,
      h: 24,
      text: item.t,
      size: 17,
      color: "#F2F7F4",
      bold: true,
    });
    addText(slide, {
      x: 992,
      y: y + 40,
      w: 126,
      h: 18,
      text: item.s,
      size: 12,
      color: "#8BA29A",
      font: CODE_FONT,
    });
  });

  addText(slide, {
    x: 953,
    y: 634,
    w: 160,
    h: 24,
    text: "Shortcuts",
    size: 14,
    color: "#7FA192",
    bold: true,
    font: CODE_FONT,
  });
  ["给我一个 C++ 版的动态规划例题。", "把这个答案讲得更简单一点。", "继续追问这道题的状态转移。"].forEach((txt, idx) => {
    const y = 672 + idx * 90;
    addShape(slide, {
      x: 952,
      y,
      w: 204,
      h: 70,
      geometry: "roundRect",
      fill: "#182520",
      line: { style: "solid", fill: "#22322D", width: 1 },
    });
    addText(slide, {
      x: 968,
      y: y + 14,
      w: 172,
      h: 40,
      text: txt,
      size: 13,
      color: "#E6EFEA",
    });
  });

  addShape(slide, {
    x: 1206,
    y: 196,
    w: 500,
    h: 730,
    geometry: "roundRect",
    fill: "#0D1715",
    line: { style: "solid", fill: "#233631", width: 1 },
  });
  addText(slide, {
    x: 1230,
    y: 220,
    w: 300,
    h: 22,
    text: "ChatGPT-style algorithm assistant",
    size: 14,
    color: "#91AC9F",
    font: CODE_FONT,
  });
  addPill(slide, {
    x: 1630,
    y: 214,
    w: 54,
    h: 28,
    text: "SSE",
    fill: ORANGE_SOFT,
    color: ORANGE,
    border: "#F2D0B0",
    size: 13,
  });
  addShape(slide, {
    x: 1230,
    y: 262,
    w: 402,
    h: 50,
    geometry: "roundRect",
    fill: "#162421",
    line: { style: "solid", fill: "#263833", width: 1 },
  });
  addText(slide, {
    x: 1252,
    y: 276,
    w: 280,
    h: 22,
    text: "知识库：本地算法知识库 · RAG 已启用",
    size: 14,
    color: "#B7D2C4",
    font: CODE_FONT,
  });
  addShape(slide, {
    x: 1230,
    y: 338,
    w: 330,
    h: 118,
    geometry: "roundRect",
    fill: "#1A2724",
    line: { style: "solid", fill: "#2A3C36", width: 1 },
  });
  addText(slide, {
    x: 1250,
    y: 356,
    w: 292,
    h: 78,
    text: "我想复习一下动态规划，\n最好能给我一个能直接上手的题目。",
    size: 21,
    color: "#FFFFFF",
  });
  addShape(slide, {
    x: 1280,
    y: 486,
    w: 350,
    h: 168,
    geometry: "roundRect",
    fill: GREEN,
    line: { style: "solid", fill: GREEN, width: 1 },
  });
  addText(slide, {
    x: 1302,
    y: 506,
    w: 308,
    h: 126,
    text: "会先检索本地知识库，\n如果命中，就把相关片段拼进 prompt。\n如果模型不可用，也会回退到本地回答。",
    size: 20,
    color: "#FFFFFF",
  });
  addPill(slide, {
    x: 1230,
    y: 680,
    w: 118,
    h: 32,
    text: "本地检索",
    fill: MINT,
    color: GREEN_DARK,
    border: "#BFE1D2",
    size: 14,
  });
  addPill(slide, {
    x: 1362,
    y: 680,
    w: 120,
    h: 32,
    text: "流式输出",
    fill: "#E7F0EC",
    color: INK,
    border: "#D3DED9",
    size: 14,
  });
  addPill(slide, {
    x: 1494,
    y: 680,
    w: 126,
    h: 32,
    text: "自动保存",
    fill: "#F3EBDD",
    color: INK,
    border: "#E1D6C5",
    size: 14,
  });
  addShape(slide, {
    x: 1230,
    y: 732,
    w: 392,
    h: 78,
    geometry: "roundRect",
    fill: "#162521",
    line: { style: "solid", fill: "#2D413B", width: 1 },
  });
  addText(slide, {
    x: 1252,
    y: 752,
    w: 280,
    h: 24,
    text: "Message AlgoGuide...",
    size: 18,
    color: "#6C857D",
    italic: true,
    font: CODE_FONT,
  });
  addPill(slide, {
    x: 1568,
    y: 747,
    w: 30,
    h: 30,
    text: "→",
    fill: GREEN,
    color: "#FFFFFF",
    border: GREEN,
    size: 16,
  });
  addText(slide, {
    x: 96,
    y: 992,
    w: 740,
    h: 22,
    text: "AlgoGuide Agent · 答辩展示版",
    size: 13,
    color: "#8A958F",
    font: CODE_FONT,
  });
}

function buildProblem(slide) {
  slide.background.fill = solid(BG);
  addHeader(slide, {
    section: "01 / 背景",
    title: "算法问答的难点，\n不在“回答”，而在“持续回答得对”",
    subtitle: "算法学习不是一次性问答，用户会不断追问、补问和换个角度问，所以系统必须把检索、生成、历史和兜底放在一起。",
  });

  addText(slide, {
    x: 96,
    y: 360,
    w: 720,
    h: 36,
    text: "三个真实痛点",
    size: 17,
    color: GREEN,
    bold: true,
    font: CODE_FONT,
  });

  const pains = [
    "问题表达常常是口语化的，\n仅靠关键词命中不够准。",
    "追问时如果丢上下文，\n答案就会开始跑偏。",
    "模型接口不稳定时，\n页面不能直接失效。",
  ];
  pains.forEach((txt, idx) => {
    const y = 414 + idx * 146;
    addShape(slide, {
      x: 96,
      y,
      w: 780,
      h: 118,
      geometry: "roundRect",
      fill: CARD,
      line: { style: "solid", fill: LINE, width: 1 },
      shadow: SHADOW,
    });
    addShape(slide, {
      x: 124,
      y: y + 28,
      w: 48,
      h: 48,
      geometry: "ellipse",
      fill: idx === 0 ? MINT : idx === 1 ? "#F0E7DA" : ORANGE_SOFT,
    });
    addText(slide, {
      x: 124,
      y: y + 34,
      w: 48,
      h: 28,
      text: String(idx + 1),
      size: 22,
      color: idx === 2 ? ORANGE : GREEN_DARK,
      bold: true,
      align: "center",
      valign: "middle",
    });
    addText(slide, {
      x: 194,
      y: y + 24,
      w: 620,
      h: 70,
      text: txt,
      size: 24,
      color: INK,
      bold: true,
    });
  });

  addShape(slide, {
    x: 980,
    y: 350,
    w: 844,
    h: 470,
    geometry: "roundRect",
    fill: "#11201D",
    line: { style: "solid", fill: "#2A413B", width: 1 },
    shadow: SHADOW,
  });
  addText(slide, {
    x: 1012,
    y: 380,
    w: 300,
    h: 28,
    text: "项目目标",
    size: 18,
    color: "#A9C7BB",
    bold: true,
    font: CODE_FONT,
  });
  addText(slide, {
    x: 1012,
    y: 420,
    w: 700,
    h: 96,
    text: "把“能答”变成“能持续答对”。\n让系统在算法学习场景里同时具备检索准确性、对话连续性和服务稳定性。",
    size: 28,
    color: "#FFFFFF",
    bold: true,
  });
  addRule(slide, 1012, 544, 700, "#2C4A43", 2);
  addPill(slide, {
    x: 1012,
    y: 574,
    w: 128,
    h: 44,
    text: "检索更准",
    fill: GREEN,
    color: "#FFFFFF",
    border: GREEN,
    size: 18,
  });
  addPill(slide, {
    x: 1154,
    y: 574,
    w: 128,
    h: 44,
    text: "回答更顺",
    fill: "#E4EFE9",
    color: INK,
    border: "#C9DDD5",
    size: 18,
  });
  addPill(slide, {
    x: 1296,
    y: 574,
    w: 128,
    h: 44,
    text: "系统更稳",
    fill: ORANGE_SOFT,
    color: ORANGE,
    border: "#E7C7A9",
    size: 18,
  });
  addText(slide, {
    x: 1012,
    y: 650,
    w: 726,
    h: 120,
    text: "这也是为什么我没有只做一个聊天界面，而是把“提问 - 检索 - 生成 - 保存会话”整条链路一起做出来。",
    size: 24,
    color: "#CFE1D9",
  });
}

function buildFlow(slide) {
  slide.background.fill = solid("#F6F2E8");
  addHeader(slide, {
    section: "02 / 方案",
    title: "一条完整链路：\n先检索，再生成，最后保存",
    subtitle: "如果只做聊天，项目会很像一个空壳；把检索、流式生成和会话保存连起来，才有“助手”的完整感。",
  });

  const nodes = [
    { x: 96, y: 420, w: 290, title: "用户提问", body: "在网页中输入自然语言问题。", fill: "#F3EBDD" },
    { x: 430, y: 420, w: 290, title: "本地知识检索", body: "优先从算法知识库里找相关片段。", fill: MINT },
    { x: 764, y: 420, w: 290, title: "模型生成", body: "把检索结果拼进 prompt 再发给模型。", fill: "#E6EEF0" },
    { x: 1098, y: 420, w: 290, title: "失败回退", body: "模型超时或失败时，切到本地兜底。", fill: ORANGE_SOFT },
    { x: 1432, y: 420, w: 290, title: "会话保存", body: "把本轮对话写回 SQLite 并刷新侧栏。", fill: "#E8F0E9" },
  ];
  nodes.forEach((node) => {
    addShape(slide, {
      x: node.x,
      y: node.y,
      w: node.w,
      h: 170,
      geometry: "roundRect",
      fill: node.fill,
      line: { style: "solid", fill: "#D7D0C3", width: 1 },
      shadow: SHADOW,
    });
    addShape(slide, {
      x: node.x + 22,
      y: node.y + 22,
      w: 44,
      h: 44,
      geometry: "ellipse",
      fill: GREEN,
    });
    addText(slide, {
      x: node.x + 22,
      y: node.y + 29,
      w: 44,
      h: 24,
      text: "✓",
      size: 22,
      color: "#FFFFFF",
      bold: true,
      align: "center",
      valign: "middle",
      font: CODE_FONT,
    });
    addText(slide, {
      x: node.x + 84,
      y: node.y + 20,
      w: node.w - 110,
      h: 34,
      text: node.title,
      size: 24,
      color: INK,
      bold: true,
    });
    addText(slide, {
      x: node.x + 22,
      y: node.y + 84,
      w: node.w - 44,
      h: 56,
      text: node.body,
      size: 19,
      color: MUTED,
    });
  });

  for (let i = 0; i < nodes.length - 1; i += 1) {
    const a = nodes[i];
    const b = nodes[i + 1];
    addLine(slide, a.x + a.w, 505, b.x, 505, GREEN, 4);
    addShape(slide, {
      x: a.x + a.w + 8,
      y: 493,
      w: 18,
      h: 24,
      geometry: "rightArrow",
      fill: GREEN,
    });
  }

  addShape(slide, {
    x: 96,
    y: 664,
    w: 1626,
    h: 180,
    geometry: "roundRect",
    fill: CARD,
    line: { style: "solid", fill: LINE, width: 1 },
  });
  addText(slide, {
    x: 124,
    y: 690,
    w: 460,
    h: 26,
    text: "链路里的关键点",
    size: 17,
    color: GREEN,
    bold: true,
    font: CODE_FONT,
  });
  addText(slide, {
    x: 124,
    y: 730,
    w: 1500,
    h: 82,
    text: "检索优先，生成兜底。先让系统“知道应该看什么”，再让模型“负责把话说清楚”，最后让会话“真的能持续聊下去”。",
    size: 26,
    color: INK,
    bold: true,
  });
}

function buildFeatures(slide) {
  slide.background.fill = solid(BG);
  addHeader(slide, {
    section: "03 / 功能",
    title: "功能设计围绕学习体验来拼，而不是围绕页面模块来堆",
    subtitle: "每个功能都服务于同一个目标：让算法学习这件事更像一个连续的对话过程。",
  });

  addFeatureCard(slide, {
    x: 96,
    y: 352,
    w: 780,
    h: 168,
    title: "支持快捷问题填充",
    body: "侧边栏直接放入 C++ 例题、简化解释、继续追问等入口，能让答辩演示更顺。",
    accent: GREEN,
  });
  addFeatureCard(slide, {
    x: 1044,
    y: 352,
    w: 780,
    h: 168,
    title: "支持流式输出",
    body: "回答可以边生成边展示，交互体验比一次性返回更像真实聊天。",
    accent: ORANGE,
  });
  addFeatureCard(slide, {
    x: 96,
    y: 560,
    w: 780,
    h: 168,
    title: "支持本地会话保存",
    body: "刷新后还能看见历史会话，侧栏会显示最近的聊天记录和摘要。",
    accent: "#3F7B6B",
  });
  addFeatureCard(slide, {
    x: 1044,
    y: 560,
    w: 780,
    h: 168,
    title: "支持本地知识检索 + 兜底",
    body: "先把知识文档切块并做语义检索；如果模型不可用，仍能给出可用答案。",
    accent: "#5A6D64",
  });

  addShape(slide, {
    x: 96,
    y: 780,
    w: 1728,
    h: 154,
    geometry: "roundRect",
    fill: "#11221F",
    line: { style: "solid", fill: "#29423B", width: 1 },
  });
  addText(slide, {
    x: 124,
    y: 806,
    w: 460,
    h: 24,
    text: "最终效果",
    size: 17,
    color: "#9CCAB9",
    bold: true,
    font: CODE_FONT,
  });
  addText(slide, {
    x: 124,
    y: 844,
    w: 1580,
    h: 64,
    text: "不是一个孤立的聊天框，而是一个能“问 - 查 - 答 - 存 - 续问”的算法学习工作台。",
    size: 28,
    color: "#FFFFFF",
    bold: true,
  });
}

function buildArchitecture(slide) {
  slide.background.fill = solid("#F6F3ED");
  addHeader(slide, {
    section: "04 / 架构",
    title: "前端、编排层、知识层各自做一件事",
    subtitle: "把职责拆开后，代码更清楚，排查问题也更快。FastAPI 管接口，retriever 管检索，sessions 管持久化。",
  });

  const layers = [
    {
      y: 360,
      label: "前端",
      title: "static/",
      body: "聊天界面、快捷问题、会话列表、流式消息渲染",
      fill: "#FFF6EA",
      accent: ORANGE,
    },
    {
      y: 538,
      label: "编排层",
      title: "app.py + agent/chain.py",
      body: "FastAPI 接口、模型调用、SSE 流、状态检查、消息拼装",
      fill: MINT,
      accent: GREEN,
    },
    {
      y: 716,
      label: "知识与存储",
      title: "retriever.py + knowledge/ + sessions.py",
      body: "Sentence Transformers、FAISS、SQLite、旧 JSON 导入",
      fill: "#E7F0ED",
      accent: "#3E7568",
    },
  ];

  layers.forEach((item, idx) => {
    addShape(slide, {
      x: 96,
      y: item.y,
      w: 1660,
      h: 132,
      geometry: "roundRect",
      fill: item.fill,
      line: { style: "solid", fill: LINE, width: 1 },
      shadow: SHADOW,
    });
    addShape(slide, {
      x: 122,
      y: item.y + 28,
      w: 92,
      h: 76,
      geometry: "roundRect",
      fill: item.accent,
    });
    addText(slide, {
      x: 122,
      y: item.y + 48,
      w: 92,
      h: 30,
      text: item.label,
      size: 20,
      color: "#FFFFFF",
      bold: true,
      align: "center",
      valign: "middle",
      font: CODE_FONT,
    });
    addText(slide, {
      x: 250,
      y: item.y + 24,
      w: 430,
      h: 30,
      text: item.title,
      size: 24,
      color: INK,
      bold: true,
      font: CODE_FONT,
    });
    addText(slide, {
      x: 250,
      y: item.y + 64,
      w: 1050,
      h: 36,
      text: item.body,
      size: 22,
      color: MUTED,
    });
    if (idx < layers.length - 1) {
      addShape(slide, {
        x: 1570,
        y: item.y + 40,
        w: 104,
        h: 52,
        geometry: "rightArrow",
        fill: item.accent,
      });
    }
  });

  addShape(slide, {
    x: 1380,
    y: 374,
    w: 330,
    h: 80,
    geometry: "roundRect",
    fill: "#FFFFFF",
    line: { style: "solid", fill: "#D9DDD9", width: 1 },
  });
  addText(slide, {
    x: 1404,
    y: 392,
    w: 282,
    h: 24,
    text: "FastAPI / SSE / status / sessions",
    size: 17,
    color: INK,
    bold: true,
    font: CODE_FONT,
  });
}

function buildEngineering(slide) {
  slide.background.fill = solid(BG);
  addHeader(slide, {
    section: "05 / 亮点",
    title: "我重点处理的 4 个工程细节",
    subtitle: "这些点不是炫技，而是保证这个原型在答辩演示时“真能用、用得稳”。",
  });

  addMetricChip(slide, 96, 338, 264, "8", "最近上下文消息数");
  addMetricChip(slide, 384, 338, 264, "60s", "模型请求超时时间");
  addMetricChip(slide, 672, 338, 264, "3000ms", "SQLite 等待时间");
  addMetricChip(slide, 960, 338, 264, "FAISS", "语义检索索引");

  const highlights = [
    {
      y: 500,
      t: "语义检索",
      b: "先把知识文档切块，再用 sentence-transformers 编码成向量，最后用 FAISS 做相似度搜索。",
      c: GREEN,
    },
    {
      y: 628,
      t: "流式输出",
      b: "/api/chat/stream 通过 SSE 把回答逐段返回，用户能看到“正在生成”的过程。",
      c: ORANGE,
    },
    {
      y: 756,
      t: "兜底机制",
      b: "当外部模型失败或超时，系统自动退回本地回答，避免页面直接变成空白。",
      c: "#3F7B6B",
    },
    {
      y: 884,
      t: "稳定性优化",
      b: "前端加单请求锁，后端给 SQLite busy_timeout，并保留旧 JSON 的自动导入逻辑。",
      c: "#5A6D64",
    },
  ];
  highlights.forEach((item, idx) => {
    addShape(slide, {
      x: 96,
      y: item.y,
      w: 1660,
      h: 102,
      geometry: "roundRect",
      fill: CARD,
      line: { style: "solid", fill: LINE, width: 1 },
      shadow: SHADOW,
    });
    addShape(slide, {
      x: 124,
      y: item.y + 22,
      w: 58,
      h: 58,
      geometry: "ellipse",
      fill: item.c,
    });
    addText(slide, {
      x: 124,
      y: item.y + 30,
      w: 58,
      h: 30,
      text: String(idx + 1),
      size: 24,
      color: "#FFFFFF",
      bold: true,
      align: "center",
      valign: "middle",
      font: CODE_FONT,
    });
    addText(slide, {
      x: 208,
      y: item.y + 18,
      w: 200,
      h: 24,
      text: item.t,
      size: 25,
      color: INK,
      bold: true,
    });
    addText(slide, {
      x: 208,
      y: item.y + 50,
      w: 1400,
      h: 36,
      text: item.b,
      size: 20,
      color: MUTED,
    });
  });
}

function buildDemo(slide) {
  slide.background.fill = solid("#F6F3ED");
  addHeader(slide, {
    section: "06 / 演示",
    title: "答辩时我会怎么演示",
    subtitle: "把演示顺序提前设计好，能让老师更快看到项目的完整闭环。",
  });

  const steps = [
    ["1", "输入一个算法问题", "比如动态规划、图论或前缀和。"],
    ["2", "侧栏选一个历史会话", "刷新后依然能续聊，历史不会丢。"],
    ["3", "观察流式返回", "能看到模型生成过程和知识库命中状态。"],
    ["4", "追问并切换话题", "验证上下文和兜底逻辑是否正常。"],
  ];
  steps.forEach((step, idx) => {
    const x = 96 + idx * 420;
    addShape(slide, {
      x,
      y: 378,
      w: 360,
      h: 212,
      geometry: "roundRect",
      fill: idx % 2 === 0 ? CARD : "#F2EFE7",
      line: { style: "solid", fill: LINE, width: 1 },
      shadow: SHADOW,
    });
    addShape(slide, {
      x: x + 24,
      y: 402,
      w: 52,
      h: 52,
      geometry: "ellipse",
      fill: idx === 2 ? ORANGE : GREEN,
    });
    addText(slide, {
      x: x + 24,
      y: 410,
      w: 52,
      h: 28,
      text: step[0],
      size: 24,
      color: "#FFFFFF",
      bold: true,
      align: "center",
      valign: "middle",
      font: CODE_FONT,
    });
    addText(slide, {
      x: x + 96,
      y: 404,
      w: 220,
      h: 54,
      text: step[1],
      size: 24,
      color: INK,
      bold: true,
    });
    addText(slide, {
      x: x + 24,
      y: 484,
      w: 312,
      h: 76,
      text: step[2],
      size: 20,
      color: MUTED,
    });
  });

  addShape(slide, {
    x: 96,
    y: 650,
    w: 1140,
    h: 240,
    geometry: "roundRect",
    fill: "#11211E",
    line: { style: "solid", fill: "#28423B", width: 1 },
  });
  addText(slide, {
    x: 124,
    y: 680,
    w: 220,
    h: 24,
    text: "可以继续扩展的方向",
    size: 17,
    color: "#9FC8B9",
    bold: true,
    font: CODE_FONT,
  });
  const future = [
    "多知识库切换",
    "更长的长期记忆",
    "检索效果评估",
    "权限与日志审计",
  ];
  future.forEach((txt, idx) => {
    addPill(slide, {
      x: 124 + idx * 250,
      y: 736,
      w: 214,
      h: 44,
      text: txt,
      fill: idx % 2 === 0 ? "#E2F0E8" : "#F5E7D6",
      color: idx % 2 === 0 ? GREEN_DARK : INK,
      border: idx % 2 === 0 ? "#C2DCD0" : "#E6D3BC",
      size: 17,
    });
  });
  addText(slide, {
    x: 124,
    y: 812,
    w: 1040,
    h: 48,
    text: "当前版本已经把最核心的“问 - 查 - 答 - 存”闭环跑通，后续就是把它做得更准、更稳、更可扩展。",
    size: 24,
    color: "#D7E9E2",
    bold: true,
  });

  addShape(slide, {
    x: 1270,
    y: 650,
    w: 650,
    h: 240,
    geometry: "roundRect",
    fill: CARD,
    line: { style: "solid", fill: LINE, width: 1 },
    shadow: SHADOW,
  });
  addText(slide, {
    x: 1298,
    y: 680,
    w: 250,
    h: 24,
    text: "答辩收束句",
    size: 17,
    color: GREEN,
    bold: true,
    font: CODE_FONT,
  });
  addText(slide, {
    x: 1298,
    y: 720,
    w: 560,
    h: 102,
    text: "AlgoGuide Agent 已经不是单纯的聊天页面，而是一个面向算法学习场景、具备检索、生成、保存和兜底能力的完整原型。",
    size: 28,
    color: INK,
    bold: true,
  });
}

const presentation = Presentation.create({
  slideSize: { width: WIDTH, height: HEIGHT },
});

const slideBuilders = [
  buildCover,
  buildProblem,
  buildFlow,
  buildFeatures,
  buildArchitecture,
  buildEngineering,
  buildDemo,
];

const slideFiles = [];
for (const build of slideBuilders) {
  const slide = presentation.slides.add();
  build(slide);
  slideFiles.push(slide);
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.mkdir(PNG_DIR, { recursive: true });
await fs.mkdir(LAYOUT_DIR, { recursive: true });

async function saveBlob(blob, filePath) {
  if (blob && typeof blob.save === "function") {
    await blob.save(filePath);
    return;
  }
  let buffer;
  if (blob && typeof blob.arrayBuffer === "function") {
    buffer = Buffer.from(await blob.arrayBuffer());
  } else if (blob && blob.bytes) {
    const bytes = blob.bytes instanceof Uint8Array ? blob.bytes : new Uint8Array(blob.bytes);
    buffer = Buffer.from(bytes);
  } else if (blob && blob.data) {
    const bytes = blob.data instanceof Uint8Array ? blob.data : new Uint8Array(blob.data);
    buffer = Buffer.from(bytes);
  } else if (blob instanceof Uint8Array) {
    buffer = Buffer.from(blob);
  } else if (blob instanceof ArrayBuffer) {
    buffer = Buffer.from(new Uint8Array(blob));
  } else if (Buffer.isBuffer(blob)) {
    buffer = blob;
  } else {
    throw new TypeError(`Unsupported blob type for ${filePath}`);
  }
  await fs.writeFile(filePath, buffer);
}

for (let i = 0; i < slideFiles.length; i += 1) {
  const slide = slideFiles[i];
  const index = String(i + 1).padStart(2, "0");
  const pngPath = path.join(PNG_DIR, `slide-${index}.png`);
  const layoutPath = path.join(LAYOUT_DIR, `slide-${index}.json`);
  await saveBlob(await slide.export({ format: "png" }), pngPath);
  await saveBlob(await slide.export({ format: "layout" }), layoutPath);
}

const pptxBlob = await PresentationFile.exportPptx(presentation);
await saveBlob(pptxBlob, path.join(OUT_DIR, "output.pptx"));

console.log(
  JSON.stringify(
    {
      pptx: path.join(OUT_DIR, "output.pptx"),
      previews: slideFiles.map((_, i) => path.join(PNG_DIR, `slide-${String(i + 1).padStart(2, "0")}.png`)),
      layouts: slideFiles.map((_, i) => path.join(LAYOUT_DIR, `slide-${String(i + 1).padStart(2, "0")}.json`)),
    },
    null,
    2,
  ),
);
