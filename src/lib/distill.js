// 영문 본문을 받아 한글로 번역·구조화·증류한다. (Claude claude-sonnet-4-6)
// 독자 관점(렌즈)은 사용자가 주입할 수 있고, 비우면 기본값(반도체 마케터·AI 동향)을 쓴다.
// 무관한 글까지 억지로 그 관점에 끼워 맞추지 않도록 — 연관도를 정직하게 표시한다.
import Anthropic from "@anthropic-ai/sdk";
import https from "node:https";
import { Readable } from "node:stream";

// 번역·구조화는 Opus까지 안 가도 품질이 충분하고, Sonnet은 출력이 40% 저렴하다
// ($25→$15/1M). 비용을 크게 줄이려고 Sonnet 4.6을 기본으로 쓴다.
const MODEL = "claude-sonnet-4-6";
export const MODEL_LABEL = "Sonnet 4.6"; // 화면 표시용
const RATE_IN = 3, RATE_OUT = 15; // $/1M (Sonnet 4.6)

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
export async function distillPdf(base64, { filename = "문서", onProgress, perspective = "" } = {}) {
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
          text: `이 PDF 문서("${filename}")를 위 원칙에 따라 한글로 번역·구조화·증류해줘.`,
        },
      ],
    },
  ], onProgress, perspective);
}


