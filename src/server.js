// 영문 링크 → 한글 증류 리더 — 서버.
// 링크를 받으면 본문을 가져와 한글로 번역·구조화·증류해 돌려준다.
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import { fetchArticle } from "./lib/fetchArticle.js";
import { distillArticle, distillPdf, estimateCostUsd, MODEL_LABEL, inferReaderProfile } from "./lib/distill.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// 긴 글이면 시작 시점에 예상 비용을 로그로 알려준다(경고 표시).
const LONG_CHARS = 40000;
function warnIfLong(onProgress, chars) {
  if (chars > LONG_CHARS) {
    const usd = estimateCostUsd(chars);
    onProgress(`⚠️ 긴 글(${chars.toLocaleString()}자) — 예상 비용 약 $${usd.toFixed(2)} (모델: ${MODEL_LABEL})`);
  }
}

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

// ──────────────────────────────────────────────────────────────
// 작업(job) 모델: 변환을 "연결"이 아니라 서버 메모리에 묶는다.
// 브라우저가 백그라운드로 가거나 탭이 새로고침돼도 작업은 계속 돌고,
// 클라이언트는 jobId로 폴링해 진행 상황과 결과를 이어받는다.
// (무료 Render는 단일 인스턴스 + 장시간 유휴 시 잠들므로, 메모리 저장으로 충분.)
// ──────────────────────────────────────────────────────────────
const jobs = new Map(); // id -> { id, status, steps, result, error, createdAt }
const JOB_TTL = 30 * 60 * 1000; // 30분 후 만료

function sweepJobs(now) {
  for (const [id, j] of jobs) {
    if (now - j.createdAt > JOB_TTL) jobs.delete(id);
  }
}

// run(onProgress)을 연결과 무관하게 백그라운드로 실행하고 job을 반환한다.
function startJob(run) {
  const now = Date.now();
  sweepJobs(now);
  const id = "job_" + now.toString(36) + Math.random().toString(36).slice(2, 8);
  const job = { id, status: "running", steps: [], result: null, error: null, createdAt: now };
  jobs.set(id, job);

  const onProgress = (msg) => job.steps.push({ ms: Date.now() - job.createdAt, msg });
  // fire-and-forget: res 수명과 분리 — 클라이언트가 떠나도 끝까지 실행된다.
  (async () => {
    try {
      job.result = await run(onProgress);
      job.status = "done";
    } catch (err) {
      job.error = err.message || "처리 중 오류가 발생했습니다.";
      job.status = "error";
    }
  })();

  return job;
}

// 작업 진행 상황/결과 폴링.
app.get("/api/job/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({
      error: "작업을 찾을 수 없어요. (오래 지나 만료됐거나 서버가 재시작됐을 수 있어요)",
    });
  }
  res.json({
    status: job.status,
    steps: job.steps,
    result: job.result,
    error: job.error,
  });
});

// 링크 → 본문 fetch → 증류 (백그라운드 작업으로 실행, jobId 즉시 반환)
app.post("/api/digest", (req, res) => {
  const { url, perspective = "" } = req.body || {};
  if (!url) return res.status(400).json({ error: "링크가 없습니다." });
  const job = startJob(async (onProgress) => {
    onProgress(`링크 여는 중: ${url.trim()}`);
    const fetched = await fetchArticle(url.trim(), onProgress);
    const srcUrl = fetched.url || url; // 트윗 공유 링크면 실제 목적지 URL
    onProgress(`본문 확보 (${fetched.text.length.toLocaleString()}자) — 증류 단계로`);
    warnIfLong(onProgress, fetched.text.length);
    const result = await distillArticle(fetched.text, {
      url: srcUrl, sourceTitle: fetched.title, onProgress, perspective,
    });
    return { url: srcUrl, via: fetched.via, ...result, perspective };
  });
  res.json({ jobId: job.id });
});

// 본문 직접 붙여넣기 → 증류 (봇 차단 사이트 우회용)
app.post("/api/digest-text", (req, res) => {
  const { text, url = "", title = "", perspective = "" } = req.body || {};
  if (!text || text.trim().length < 100) {
    return res.status(400).json({ error: "본문 텍스트가 너무 짧습니다." });
  }
  const job = startJob(async (onProgress) => {
    onProgress(`붙여넣은 본문 ${text.trim().length.toLocaleString()}자 — 증류 시작`);
    warnIfLong(onProgress, text.trim().length);
    const result = await distillArticle(text.trim(), { url, sourceTitle: title, onProgress, perspective });
    return { url, via: "paste", ...result, perspective };
  });
  res.json({ jobId: job.id });
});

// PDF 업로드(base64) → Claude가 직접 읽어 정리
app.post("/api/digest-pdf", (req, res) => {
  const { base64, filename = "문서.pdf", url = "", perspective = "" } = req.body || {};
  if (!base64 || base64.length < 100) {
    return res.status(400).json({ error: "PDF 데이터가 비어 있습니다." });
  }
  const job = startJob(async (onProgress) => {
    onProgress(`PDF "${filename}" 업로드됨 — Claude가 직접 읽는 중`);
    if (base64.length > 2_000_000) { // ~1.5MB 이상 → 분량 큼
      onProgress(`⚠️ 분량이 큰 PDF — 쪽수가 많으면 비용이 더 들 수 있어요 (모델: ${MODEL_LABEL})`);
    }
    const result = await distillPdf(base64, { filename, onProgress, perspective });
    return { url, via: "pdf", ...result, perspective };
  });
  res.json({ jobId: job.id });
});

// 읽은 글 목록으로 "내 프로필(독자 관점)"을 추론한다. 작은 호출이라 동기 처리.
app.post("/api/profile", async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "읽은 글이 없어 프로필을 만들 수 없어요." });
  }
  try {
    const profile = await inferReaderProfile(items);
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: err.message || "프로필 생성 중 오류가 발생했습니다." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`영문 링크 → 한글 증류 리더가 http://localhost:${PORT} 에서 실행 중입니다.`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠️  .env 에 ANTHROPIC_API_KEY 를 설정해야 정상 동작합니다.");
  }
});
