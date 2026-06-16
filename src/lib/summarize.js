// Claude(claude-opus-4-8)로 텍스트/PDF를 구조화해서 정리한다.
// 결과: 핵심 요약 + 항목별 정리(안건/결정사항/할 일).
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-8";

// 키가 없어도 서버는 뜨도록, 클라이언트는 실제 사용할 때 만든다.
let _anthropic;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다. .env 파일을 확인해주세요.");
  }
  return (_anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
}

// 모든 결과물이 따르는 구조. (구조화 출력 제약상 additionalProperties:false 필요)
const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "내용을 대표하는 짧은 제목" },
    summary: { type: "string", description: "핵심을 3~6문장으로 압축한 요약" },
    keyPoints: {
      type: "array",
      items: { type: "string" },
      description: "핵심 포인트 불릿 목록",
    },
    decisions: {
      type: "array",
      items: { type: "string" },
      description: "합의·결정된 사항 (없으면 빈 배열)",
    },
    actionItems: {
      type: "array",
      items: { type: "string" },
      description: "할 일 / 후속 조치 (담당자·기한이 있으면 포함, 없으면 빈 배열)",
    },
  },
  required: ["title", "summary", "keyPoints", "decisions", "actionItems"],
  additionalProperties: false,
};

const SYSTEM = `너는 한국어 회의록·문서 정리 도우미다.
주어진 자료(회의 녹취, 영상 자막, 또는 문서)를 읽고 핵심을 정확하게 정리한다.
- 추측하지 말고 자료에 실제로 있는 내용만 정리한다.
- 회의가 아닌 일반 문서/논문이면 decisions·actionItems는 비워도 된다.
- 모든 출력은 한국어로 작성한다.`;

function parseResult(message) {
  const block = message.content.find((b) => b.type === "text");
  if (!block) throw new Error("Claude 응답에서 결과를 찾지 못했습니다.");
  return JSON.parse(block.text);
}

/**
 * 일반 텍스트(받아쓰기 결과, 자막 등)를 구조화 정리.
 * @param {string} text
 * @param {{sourceType?: string}} [opts]
 */
export async function summarizeText(text, { sourceType = "회의 기록" } = {}) {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: `다음은 "${sourceType}" 내용이다. 핵심 요약과 항목별 정리를 만들어줘.\n\n---\n${text}`,
      },
    ],
  });
  return parseResult(message);
}

/**
 * PDF(논문·문서 등)를 직접 읽어 구조화 정리.
 * @param {string} base64 - PDF 파일의 base64 인코딩
 * @param {{filename?: string}} [opts]
 */
export async function summarizePdf(base64, { filename = "문서" } = {}) {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
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
            text: `이 문서("${filename}")의 핵심 요약과 항목별 정리를 만들어줘.`,
          },
        ],
      },
    ],
  });
  return parseResult(message);
}
