// 회의록 정리 시스템 — 서버.
// 음성/영상 파일, 유튜브 링크, PDF를 받아 받아쓰기·요약·항목별 정리를 반환한다.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";

import { transcribeMedia } from "./lib/transcribe.js";
import { fetchYoutubeTranscript } from "./lib/youtube.js";
import { summarizeText, summarizePdf } from "./lib/summarize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const UPLOAD_DIR = path.join(ROOT, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(ROOT, "public")));

// 업로드: 최대 500MB (1시간 영상도 수용)
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 500 * 1024 * 1024 },
});

// 어떤 키가 설정됐는지 프런트가 알 수 있게.
app.get("/api/health", (_req, res) => {
  res.json({
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
  });
});

function cleanup(file) {
  if (file?.path) fs.rm(file.path, { force: true }, () => {});
}

// 1) 음성/영상 파일 → 받아쓰기 + 정리
app.post("/api/process/media", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "파일이 없습니다." });
  try {
    const transcript = await transcribeMedia(req.file.path);
    if (!transcript) {
      return res.status(422).json({ error: "받아쓰기 결과가 비어 있습니다." });
    }
    const result = await summarizeText(transcript, { sourceType: "회의 녹음/영상" });
    res.json({ source: "media", transcript, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || "처리 중 오류가 발생했습니다." });
  } finally {
    cleanup(req.file);
  }
});

// 2) 유튜브 링크 → 자막 + 정리
app.post("/api/process/youtube", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "유튜브 링크가 없습니다." });
  try {
    const transcript = await fetchYoutubeTranscript(url);
    const result = await summarizeText(transcript, { sourceType: "유튜브 영상 자막" });
    res.json({ source: "youtube", transcript, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || "처리 중 오류가 발생했습니다." });
  }
});

// 3) PDF/문서 → 정리
app.post("/api/process/document", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "파일이 없습니다." });
  try {
    const base64 = fs.readFileSync(req.file.path).toString("base64");
    const result = await summarizePdf(base64, { filename: req.file.originalname });
    res.json({ source: "document", transcript: "", ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || "처리 중 오류가 발생했습니다." });
  } finally {
    cleanup(req.file);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`회의록 정리 시스템이 http://localhost:${PORT} 에서 실행 중입니다.`);
  if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY) {
    console.warn("⚠️  .env 에 ANTHROPIC_API_KEY / OPENAI_API_KEY 를 설정해야 정상 동작합니다.");
  }
});
