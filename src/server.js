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

// HTML은 절대 캐시하지 않는다(브라우저가 옛 index.html을 붙들고 ?v= 자산을
// 영영 못 받는 문제 방지). 나머지 정적 자산은 ?v= 쿼리로 캐시를 무력화한다.
app.use(
  express.static(path.join(ROOT, "public"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ anthropic: Boolean(process.env.ANTHROPIC_API_KEY) });
});

// 진행 상황을 한 줄씩(NDJSON) 흘려보내기 위한 헬퍼.
// {type:"step",msg} 진행 단계 / {type:"result",data} 최종 / {type:"error",error}
function ndjson(res) {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no"); // 프록시 버퍼링 방지
  return (obj) => res.write(JSON.stringify(obj) + "\n");
}

// 스트리밍 작업 공통 래퍼: 단계별 진행을 흘리고 결과/에러로 마무리.
async function streamDigest(res, run) {
  const send = ndjson(res);
  const onProgress = (msg) => send({ type: "step", msg });
  try {
    const data = await run(onProgress);
    send({ type: "result", data });
  } catch (err) {
    send({ type: "error", error: err.message || "처리 중 오류가 발생했습니다." });
  }
  res.end();
}

// 링크 → 본문 fetch → 증류 (진행 상황 스트리밍)
app.post("/api/digest", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "링크가 없습니다." });
  await streamDigest(res, async (onProgress) => {
    onProgress(`링크 여는 중: ${url.trim()}`);
    const fetched = await fetchArticle(url.trim(), onProgress);
    const srcUrl = fetched.url || url; // 트윗 공유 링크면 실제 목적지 URL
    onProgress(`본문 확보 (${fetched.text.length.toLocaleString()}자) — 증류 단계로`);
    const result = await distillArticle(fetched.text, {
      url: srcUrl, sourceTitle: fetched.title, onProgress,
    });
    return { url: srcUrl, via: fetched.via, ...result };
  });
});

// 본문 직접 붙여넣기 → 증류 (봇 차단 사이트 우회용)
app.post("/api/digest-text", async (req, res) => {
  const { text, url = "", title = "" } = req.body || {};
  if (!text || text.trim().length < 100) {
    return res.status(400).json({ error: "본문 텍스트가 너무 짧습니다." });
  }
  await streamDigest(res, async (onProgress) => {
    onProgress(`붙여넣은 본문 ${text.trim().length.toLocaleString()}자 — 증류 시작`);
    const result = await distillArticle(text.trim(), { url, sourceTitle: title, onProgress });
    return { url, via: "paste", ...result };
  });
});

// PDF 업로드(base64) → Claude가 직접 읽어 정리
app.post("/api/digest-pdf", async (req, res) => {
  const { base64, filename = "문서.pdf", url = "" } = req.body || {};
  if (!base64 || base64.length < 100) {
    return res.status(400).json({ error: "PDF 데이터가 비어 있습니다." });
  }
  await streamDigest(res, async (onProgress) => {
    onProgress(`PDF "${filename}" 업로드됨 — Claude가 직접 읽는 중`);
    const result = await distillPdf(base64, { filename, onProgress });
    return { url, via: "pdf", ...result };
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`영문 링크 → 한글 증류 리더가 http://localhost:${PORT} 에서 실행 중입니다.`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠️  .env 에 ANTHROPIC_API_KEY 를 설정해야 정상 동작합니다.");
  }
});
