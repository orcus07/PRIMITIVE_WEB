// 영문 링크 → 한글 증류 리더 — 서버.
// 링크를 받으면 본문을 가져와 한글로 번역·구조화·증류해 돌려준다.
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import { fetchArticle } from "./lib/fetchArticle.js";
import { distillArticle, distillPdf } from "./lib/distill.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const app = express();
app.use(express.json({ limit: "30mb" })); // PDF base64 수용
app.use(express.static(path.join(ROOT, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ anthropic: Boolean(process.env.ANTHROPIC_API_KEY) });
});

// 링크 → 본문 fetch → 증류
app.post("/api/digest", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "링크가 없습니다." });
  try {
    const fetched = await fetchArticle(url.trim());
    const srcUrl = fetched.url || url; // 트윗 공유 링크면 실제 목적지 URL
    const result = await distillArticle(fetched.text, { url: srcUrl, sourceTitle: fetched.title });
    res.json({ url: srcUrl, via: fetched.via, ...result });
  } catch (err) {
    res.status(502).json({ error: err.message || "처리 중 오류가 발생했습니다." });
  }
});

// 본문 직접 붙여넣기 → 증류 (봇 차단 사이트 우회용)
app.post("/api/digest-text", async (req, res) => {
  const { text, url = "", title = "" } = req.body || {};
  if (!text || text.trim().length < 100) {
    return res.status(400).json({ error: "본문 텍스트가 너무 짧습니다." });
  }
  try {
    const result = await distillArticle(text.trim(), { url, sourceTitle: title });
    res.json({ url, via: "paste", ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || "처리 중 오류가 발생했습니다." });
  }
});

// PDF 업로드(base64) → Claude가 직접 읽어 정리
app.post("/api/digest-pdf", async (req, res) => {
  const { base64, filename = "문서.pdf", url = "" } = req.body || {};
  if (!base64 || base64.length < 100) {
    return res.status(400).json({ error: "PDF 데이터가 비어 있습니다." });
  }
  try {
    const result = await distillPdf(base64, { filename });
    res.json({ url, via: "pdf", ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || "처리 중 오류가 발생했습니다." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`영문 링크 → 한글 증류 리더가 http://localhost:${PORT} 에서 실행 중입니다.`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠️  .env 에 ANTHROPIC_API_KEY 를 설정해야 정상 동작합니다.");
  }
});
