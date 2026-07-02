// 영문 본문을 받아 한글로 번역·구조화·증류한다. (Claude claude-sonnet-5)
// 독자 관점(렌즈)은 사용자가 주입할 수 있고, 비우면 기본값(반도체 마케터·AI 동향)을 쓴다.
// 무관한 글까지 억지로 그 관점에 끼워 맞추지 않도록 — 연관도를 정직하게 표시한다.
import Anthropic from "@anthropic-ai/sdk";
import https from "node:https";
import { Readable } from "node:stream";

// 번역·구조화는 Opus까지 안 가도 품질이 충분하다. Sonnet 5는 4.6 후속이면서 정가가
// 동일($3/$15 per 1M)이고, 2026-08-31까지 도입가($2/$10)로 오히려 더 싸다.
// API 표면(adaptive thinking·구조화 출력·스트리밍)도 동일해 모델 ID만 교체하면 된다.
const MODEL = "claude-sonnet-5";
export const MODEL_LABEL = "Sonnet 5"; // 화면 표시용
const RATE_IN = 3, RATE_OUT = 15; // $/1M (정가 기준. 도입가는 더 저렴 → 추정이 보수적)

// 입력 글자수로 변환 비용을 대략 추정한다(아주 거친 추정 — 경고 표시용).
export function estimateCostUsd(chars) {
  const inTok = chars / 4;                       // 영어 ≈ 4자/토큰
  const outTok = Math.min(inTok * 1.3, 64000);   // 한글 번역 출력 대략, 한도 64K
  return (inTok * RATE_IN + outTok * RATE_OUT) / 1e6;
}

// node:https 기반 custom fetch — Render에서 native fetch(undici)가 Anthropic 연결을
// 도중에 끊는("Premature close") 문제를 우회한다. (응답을 끝까지 받아 버퍼로 반환)
function httpsFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const rawBody = options.body;
    const bodyBuf = rawBody == null ? null
                  : rawBody instanceof Uint8Array ? rawBody
                  : Buffer.from(rawBody);

    const headers = { ...(options.headers || {}) };
    if (bodyBuf) headers["content-length"] = bodyBuf.length;

    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: options.method || "GET", headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString("utf-8");
          const h = res.headers;
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage || "",
            url,
            redirected: false,
            type: "basic",
            bodyUsed: false,
            headers: {
              get: (n) => { const v = h[n.toLowerCase()]; return Array.isArray(v) ? v.join(", ") : (v ?? null); },
              has: (n) => n.toLowerCase() in h,
              entries: () => Object.entries(h),
              forEach: (cb) => Object.entries(h).forEach(([k, v]) => cb(String(v), k)),
            },
            body: Readable.toWeb ? Readable.toWeb(Readable.from([buf])) : null,
            clone() { return this; },
            json: () => Promise.resolve(JSON.parse(text)),
            text: () => Promise.resolve(text),
            arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
            blob: () => Promise.resolve(new Blob([buf])),
            formData: () => Promise.reject(new Error("formData not supported")),
          });
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    if (options.signal) {
      if (options.signal.aborted) { req.destroy(); return; }
      options.signal.addEventListener("abort", () => req.destroy(), { once: true });
    }
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

let _client;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다. .env 파일을 확인해주세요.");
  }
  return (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: httpsFetch }));
}

const SCHEMA = {
  type: "object",
  properties: {
    koreanTitle: { type: "string", description: "원문 제목의 한글 번역" },
    originalTitle: { type: "string", description: "원문 제목(영문 그대로)" },
    publishedDate: { type: "string", description: "원문에 적힌 작성/게재 날짜. 없으면 빈 문자열" },
    oneLiner: { type: "string", description: "이 글의 핵심을 한 문장으로 증류" },
    topic: { type: "string", description: "이 글이 무엇에 관한 글인지 2~4문장으로 설명한 주제·맥락" },
    keyTakeaways: {
      type: "array",
      items: { type: "string" },
      description: "글 자체의 핵심 시사점(보편적, 원문 근거 기반). 누가 읽어도 유효한 통찰 3~5개",
    },
    keyQuotes: {
      type: "array",
      description:
        "원문에서 가장 중요한 직접 인용 2~5개 — 기억에 남는 한마디, 핵심 주장, 중요 인물의 정확한 워딩. 인용할 만한 게 없으면 빈 배열.",
      items: {
        type: "object",
        properties: {
          quote: { type: "string", description: "원문 그대로의 인용(영문). 절대 바꾸거나 지어내지 말 것." },
          speaker: { type: "string", description: "말한 사람·출처(식별되면). 없으면 빈 문자열." },
          translation: { type: "string", description: "그 인용의 한글 번역." },
        },
        required: ["quote", "speaker", "translation"],
        additionalProperties: false,
      },
    },
    marketerAngle: {
      type: "object",
      description: "설정된 독자 관점에서의 연관성. 억지로 연결하지 말 것.",
      properties: {
        relevance: {
          type: "string",
          enum: ["high", "medium", "low", "none"],
          description: "이 글이 설정된 독자 관점과 실제로 얼마나 연관되는지 정직하게",
        },
        notes: {
          type: "array",
          items: { type: "string" },
          description:
            "설정된 독자 관점의 해석·시사점(모델의 해석임). 연관이 약하면 그렇다고 솔직히 밝히고 무리한 연결은 하지 말 것. relevance가 none이면 빈 배열도 가능.",
        },
      },
      required: ["relevance", "notes"],
      additionalProperties: false,
    },
    sections: {
      type: "array",
      description: "원문 흐름을 따라 구조화한 충실한 한글 정리 (요약이 아니라 원문 의도를 살린 번역·정리)",
      items: {
        type: "object",
        properties: {
          heading: { type: "string", description: "소제목" },
          content: { type: "string", description: "해당 부분의 한글 본문 (맥락 손실 최소화)" },
          original: {
            type: "string",
            description:
              "이 섹션 한글 본문에 대응하는 원문(영문) 발췌. 번역하지 말고 원문 그대로 옮긴다. 원문을 못 구한 경우(예: 일부 트윗)엔 빈 문자열.",
          },
        },
        required: ["heading", "content", "original"],
        additionalProperties: false,
      },
    },
    keyTerms: {
      type: "array",
      description: "이해를 돕는 핵심 용어·숫자·고유명사 풀이 (없으면 빈 배열)",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          note: { type: "string", description: "짧은 한글 설명" },
        },
        required: ["term", "note"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "koreanTitle", "originalTitle", "publishedDate", "oneLiner", "topic",
    "keyTakeaways", "keyQuotes", "marketerAngle", "sections", "keyTerms",
  ],
  additionalProperties: false,
};

// 사용자가 비워두면 쓰는 기본 독자 관점.
const DEFAULT_PERSPECTIVE = "SK하이닉스의 반도체 마케터이며, AI 산업 동향에 관심이 많다";

// 독자 관점(렌즈)을 주입해 시스템 프롬프트를 만든다.
function buildSystem(perspective) {
  const lens = (perspective || "").trim() || DEFAULT_PERSPECTIVE;
  return `너는 영어 장문 자료를 한국어로 옮겨 주는 전문 에디터다.
독자는 다음 관점을 가진 사람이다 — ${lens}. 단, 이 관점은 "기본 렌즈"일 뿐이다.

번역·정리 원칙:
- 번역은 원문의 의도와 뉘앙스에 충실하게, 맥락 손실을 최소화한다. 임의로 줄이거나 왜곡하지 않는다.
- sections는 "요약"이 아니라 원문 흐름을 따라간 충실한 한글 정리다. 중요한 논지·근거·숫자·사례를 빠뜨리지 않는다.
- 각 section의 original 필드에는 그 한글 본문(content)에 대응하는 원문(영문)을 "번역하지 말고 원문 그대로" 옮긴다. 독자가 원문과 대조할 수 있게 하기 위함이다. 원문을 구할 수 없으면 빈 문자열로 둔다.
- oneLiner와 topic은 글의 본질을 증류해 한눈에 파악하게 한다.
- 원문에 없는 사실·숫자·고유명사를 절대 지어내지 않는다. 확실하지 않으면 적지 않는다.

자연스러운 우리말 원칙 (번역투를 버리고 한국어답게 — 매우 중요. 한글로 나가는 모든 필드에 적용):
- 영어 문장 구조를 그대로 옮기지 말고, 뜻을 살려 한국어 어순·표현으로 다시 쓴다. 직역투가 느껴지면 다시 손본다.
- 무생물 주어(물주 구문)를 피한다. 되도록 사람·행위자를 주어로. 예) "그 결정이 회사를 바꿨다" → "그 결정으로 회사가 바뀌었다".
- '~의'를 남발하지 말고 풀어 쓴다. 예) "회사의 성장의 핵심" → "회사가 성장한 핵심".
- 불필요한 피동·이중 피동을 능동으로 바꾼다. "~되어지다 / ~지게 되다" 같은 군더더기를 쓰지 않는다.
- 명사문보다 동사·형용사문으로 쓴다. 예) "가격의 하락이 있었다" → "가격이 떨어졌다".
- 의존명사 '것'을 줄인다. "~할 것이다(추측·당위)"는 "~한다 / ~해야 한다"로.
- 한 문장에 한 가지만 담고 짧게 쓴다. 긴 관형절은 끊어서 순서대로 풀어 쓴다.
- 불필요한 복수 '-들', 군더더기·겹말(아주 굉장히, 약 ~정도 등), 지시어(이/그/그것) 남발을 줄인다. 가리키는 대상이 모호하면 구체적 이름으로 쓴다.
- 어색한 직역 관용구는 자연스러운 한국어 관용 표현으로 바꾼다. 기본 문체는 군더더기 없는 '~다' 평서체.
- 단, 자연스러움이 원문의 사실·숫자·뉘앙스를 바꾸거나 흐리게 해선 안 된다. 정확성이 우선이고, 그 안에서 가장 한국어다운 표현을 고른다.

인사이트 원칙 (중요):
- keyTakeaways: 글 자체의 보편적 핵심 시사점. 원문 내용에 근거한 사실 기반 통찰이다.
- keyQuotes: 원문에서 가장 인상적인 직접 인용을 2~5개 고른다. 기억에 남는 한마디, 핵심 주장, 중요 인물의 발언 등. quote는 원문 영어를 "그대로" 옮기고(절대 바꾸거나 지어내지 않는다), translation에 한글 번역을, speaker에 말한 사람/출처를 적는다. 인용할 만한 게 없으면 빈 배열로 둔다.
- marketerAngle: 위 독자 관점에서의 연결은 "진짜 연관이 있을 때만" 한다.
  · 글이 그 관점과 직접 관련되면 relevance를 high/medium으로 두고 구체적으로 연결한다.
  · 관련이 약하거나 없으면 relevance를 low/none으로 솔직히 표시하고, notes에 "이 글은 해당 관점과 직접 연관은 약하다"는 점을 밝힌다. 억지로 끼워 맞추지 마라.
  · notes는 "모델의 해석"이다. 원문 사실로 단정하지 말 것.
  · 독자의 구체적 상황(특정 회사·거래처 등)을 지어내 단정하지 마라. 일반화된 제안형으로 표현한다.

- 전문 용어는 자연스러운 한국어로 옮기되 필요하면 영문 원어를 괄호로 병기한다.
- 모든 출력은 한국어로 작성한다(originalTitle 제외).`;
}

/**
 * @param {string} text - 원문 본문
 * @param {{url?: string, sourceTitle?: string}} [meta]
 */
// Render↔Anthropic 간헐적 연결 끊김("Premature close") 대비:
// 스트리밍으로 받아 연결을 유지하고, 실패하면 최대 3회 재시도한다.
async function runStructured(messages, onProgress = () => {}, perspective = "") {
  const params = {
    model: MODEL,
    // 긴 글의 충실한 번역은 출력 토큰을 많이 쓴다. 16K로는 JSON이 중간에 잘려
    // ("Unterminated string in JSON") 파싱이 실패한다. 스트리밍이라 최대 128K까지
    // 안전. effort는 medium — adaptive '사고' 토큰도 max_tokens에서 차감되므로
    // high면 출력 예산을 갉아먹는다. 번역·구조화에는 medium이 충분하고 더 빠르다.
    max_tokens: 64000,
    system: buildSystem(perspective),
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages,
  };

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      onProgress(attempt === 1 ? "Claude 증류 중… (번역·구조화)" : `Claude 재시도 ${attempt}/3…`);
      const stream = client().messages.stream(params);
      const message = await stream.finalMessage();
      // 출력이 한도에서 잘렸다면 JSON이 불완전하다. 재시도해도 같은 결과이므로
      // 즉시 명확한 안내로 중단한다(무의미한 재시도 방지).
      if (message.stop_reason === "max_tokens") {
        const err = new Error(
          "글이 너무 길어 한 번에 정리하지 못했어요(출력 한도 초과). 본문을 줄이거나 둘로 나눠서 다시 시도해주세요."
        );
        err.noRetry = true;
        throw err;
      }
      const block = message.content.find((b) => b.type === "text");
      if (!block) throw new Error("Claude 응답에서 결과를 찾지 못했습니다.");
      onProgress("✓ 증류 완료");
      return JSON.parse(block.text);
    } catch (err) {
      lastErr = err;
      onProgress(`✗ 증류 실패: ${err.message}`);
      // 재시도는 "일시적" 오류(연결 끊김·과부하·5xx)에만 한다. 잘림이나 결정적
      // 오류를 재시도하면 비싼 출력만 또 생성돼 비용이 낭비된다.
      if (err.noRetry || !isTransient(err)) throw err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000 * attempt)); // 3s, 6s
    }
  }
  throw lastErr;
}

// 재시도할 가치가 있는 일시적 오류인지. (연결 끊김 "Premature close" 포함)
function isTransient(err) {
  const s = err && err.status;
  if (s === 408 || s === 409 || s === 429 || (s >= 500 && s <= 599)) return true;
  const m = ((err && err.message) || "").toLowerCase();
  return /premature close|terminated|econnreset|socket hang|network|fetch failed|overloaded|timeout|aborted/.test(m);
}

export async function distillArticle(text, { url = "", sourceTitle = "", onProgress, perspective = "" } = {}) {
  const header = [sourceTitle && `원문 제목: ${sourceTitle}`, url && `출처: ${url}`]
    .filter(Boolean)
    .join("\n");

  return runStructured([
    {
      role: "user",
      content: `${header}\n\n아래 영어 본문을 위 원칙에 따라 한글로 번역·구조화·증류해줘.\n\n---\n${text}`,
    },
  ], onProgress, perspective);
}

// PDF(논문·보고서 등)를 Claude가 직접 읽어 정리한다.
// condensed=true(쪽수 많은 문서)면 출력 한도(64K)에 잘리지 않도록 "전체를 빠짐없이
// 다루되 핵심 위주로 압축"하라고 지시한다.
export async function distillPdf(base64, { filename = "문서", onProgress, perspective = "", condensed = false, pages = 0 } = {}) {
  const longNote = condensed
    ? `\n\n이 문서는 ${pages ? `${pages}쪽으로 ` : ""}매우 길다. 출력이 중간에 잘리지 않도록, 문서를 처음부터 끝까지 빠짐없이 다루되 핵심 논지·근거·숫자·결론 위주로 압축해 구조화하라. 덜 중요한 세부·반복은 과감히 요약한다. section의 original(원문 발췌)도 길면 핵심 문장만 짧게 담는다.`
    : "";
  return runStructured([
    {
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
          title: filename,
        },
        {
          type: "text",
          text: `이 PDF 문서("${filename}")를 위 원칙에 따라 한글로 번역·구조화·증류해줘.${longNote}`,
        },
      ],
    },
  ], onProgress, perspective);
}

// ──────────────────────────────────────────────────────────────
// 전문(全文) 한글 완역 — 원문을 토막 내 문단별로 번역해 이어붙인다.
// 한 번에 다 번역하면 출력 한도(64K)에 잘리므로 청크로 나눠 여러 번 호출한다.
// 결과는 [{ en, ko }] 세그먼트 배열(문단별 영↔한 정렬)이라 영어 토글 대조가 된다.
// ──────────────────────────────────────────────────────────────
const TRANSLATE_SCHEMA = {
  type: "object",
  properties: { translations: { type: "array", items: { type: "string" } } },
  required: ["translations"],
  additionalProperties: false,
};

function buildTranslateSystem(perspective) {
  const lens = (perspective || "").trim() || DEFAULT_PERSPECTIVE;
  return `너는 영어를 자연스러운 한국어로 옮기는 전문 번역가다. 독자는 다음 관점을 가진 사람이다 — ${lens}.

번역 원칙:
- 원문의 의미·뉘앙스에 충실하되, 영어 구조를 직역하지 말고 한국어다운 어순·표현으로 다시 쓴다(번역투 금지).
- 무생물 주어(물주구문) 회피, '~의' 남발·명사문 줄이기, 불필요한 피동·이중피동·'것'·복수 '-들'·겹말 제거, 문장은 짧게, '~다' 평서체. 정확성이 우선이고 그 안에서 가장 한국어다운 표현을 고른다.
- 원문에 없는 내용을 지어내지 않는다.

출력 형식(엄수):
- 입력으로 [1] [2] … 번호가 붙은 영어 문단들이 주어진다.
- 각 문단을 번역해, 입력과 "정확히 같은 개수"의 translations 배열로 순서대로 1:1 반환한다.
- 문단을 합치거나 나누지 말고, 번호 표시는 빼고 번역문만 담는다.`;
}

// 원문을 표시·정렬 단위인 세그먼트(문단)로 나눈다.
function splitSegments(text) {
  const blocks = String(text || "").replace(/\r/g, "").split(/\n\s*\n+/);
  const segs = [];
  for (let b of blocks) {
    b = b.replace(/\n+/g, " ").trim(); // 문단 내 하드랩(줄바꿈) 합치기 (PDF 대응)
    if (!b) continue;
    if (b.length <= 1500) { segs.push(b); continue; }
    let cur = "";
    for (const sent of b.split(/(?<=[.!?。])\s+/)) {
      if (cur && (cur + " " + sent).length > 1000) { segs.push(cur.trim()); cur = sent; }
      else cur = cur ? cur + " " + sent : sent;
    }
    if (cur.trim()) segs.push(cur.trim());
  }
  return segs;
}

// 세그먼트들을 API 호출당 글자수 상한(cap) 이하로 묶는다.
function groupChunks(segs, cap) {
  const chunks = []; let cur = []; let len = 0;
  for (const s of segs) {
    if (cur.length && len + s.length > cap) { chunks.push(cur); cur = []; len = 0; }
    cur.push(s); len += s.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

// 한 청크(영어 문단들)를 번역해 같은 길이의 한글 배열로 반환.
async function runTranslateChunk(paragraphs, perspective) {
  const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p}`).join("\n\n");
  const params = {
    model: MODEL,
    max_tokens: 64000,
    system: buildTranslateSystem(perspective),
    output_config: { effort: "medium", format: { type: "json_schema", schema: TRANSLATE_SCHEMA } },
    messages: [{
      role: "user",
      content: `아래 ${paragraphs.length}개의 영어 문단을 자연스러운 한국어로 번역해줘. 입력과 정확히 같은 ${paragraphs.length}개로, 순서대로 1:1 대응하는 translations 배열로만 반환해.\n\n---\n${numbered}`,
    }],
  };
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const stream = client().messages.stream(params);
      const message = await stream.finalMessage();
      if (message.stop_reason === "max_tokens") {
        const e = new Error("번역 구간이 출력 한도를 넘었어요."); e.noRetry = true; throw e;
      }
      const block = message.content.find((b) => b.type === "text");
      if (!block) throw new Error("번역 응답이 비어 있어요.");
      const arr = JSON.parse(block.text).translations;
      return Array.isArray(arr) ? arr : [];
    } catch (err) {
      lastErr = err;
      if (err.noRetry || !isTransient(err)) throw err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw lastErr;
}

const TRANSLATE_CHUNK_CHARS = 30000; // 청크당 영어 글자수(출력 한도 안전 범위)

export async function translateFull(text, { onProgress = () => {}, perspective = "" } = {}) {
  const segs = splitSegments(text);
  if (!segs.length) throw new Error("번역할 원문 텍스트가 없어요.");
  const chunks = groupChunks(segs, TRANSLATE_CHUNK_CHARS);
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress(`전문 한글 번역 중… (${i + 1}/${chunks.length} 구간)`);
    const ko = await runTranslateChunk(chunks[i], perspective);
    const en = chunks[i];
    for (let j = 0; j < en.length; j++) out.push({ en: en[j], ko: ko[j] != null ? ko[j] : "" });
  }
  onProgress("✓ 전문 번역 완료");
  return out;
}

// 독자가 읽은 글 목록(제목·요약·주제)만 보고 "이 독자는 누구인가"를 한 문단으로
// 추론한다. 결과는 그대로 독자 관점(렌즈)으로 쓰인다. 입력이 작아 비용이 매우 싸다.
const PROFILE_SYSTEM = `너는 한 독자의 '읽은 글 목록'만 보고 그 사람을 추론해 한 문단으로 정의하는 분석가다.
- 제목·핵심요약·주제에서 드러나는 관심사·시각·목표의 패턴을 근거로 추론한다.
- 실명·회사 같은 단정적 개인정보를 지어내지 않는다. 드러난 관심사에 근거해 일반화한다.
- 출력은 그대로 '독자 관점(렌즈)'으로 쓰인다. "이 독자는 ~에 관심이 많고, ~한 시각으로 글을 읽는다" 형태의 자연스러운 한국어 한 문단만 출력한다. 군더더기·머리말 없이 그 문단만.`;

export async function inferReaderProfile(items = []) {
  const list = (items || [])
    .slice(0, 50)
    .map((it, i) => {
      const t = (it && it.title) || "";
      const o = (it && it.oneLiner) ? ` — ${it.oneLiner}` : "";
      const tp = (it && it.topic) ? ` / ${it.topic}` : "";
      return `${i + 1}. ${t}${o}${tp}`;
    })
    .filter((s) => s.replace(/^\d+\.\s*/, "").trim())
    .join("\n");
  if (!list) throw new Error("프로필을 만들 읽은 글이 없어요.");

  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 600,
    system: PROFILE_SYSTEM,
    output_config: { effort: "low" }, // 작은 추론 — 저비용·빠르게
    messages: [
      { role: "user", content: `다음은 한 독자가 읽고 정리한 글 목록이다. 이 사람을 한 문단으로 정의해줘.\n\n${list}` },
    ],
  });
  const message = await stream.finalMessage();
  const block = message.content.find((b) => b.type === "text");
  const text = (block && block.text || "").trim();
  if (!text) throw new Error("프로필 생성 결과가 비어 있어요.");
  return text;
}


