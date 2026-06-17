// 영문 본문을 받아 한글로 번역·구조화·증류한다. (Claude claude-opus-4-8)
// 독자 페르소나(반도체 마케터 · AI 동향 관심)에 맞춰 시사점을 강조한다.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-8";

let _client;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다. .env 파일을 확인해주세요.");
  }
  return (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
}

const SCHEMA = {
  type: "object",
  properties: {
    koreanTitle: { type: "string", description: "원문 제목의 한글 번역" },
    originalTitle: { type: "string", description: "원문 제목(영문 그대로)" },
    oneLiner: { type: "string", description: "이 글의 핵심을 한 문장으로 증류" },
    topic: { type: "string", description: "이 글이 무엇에 관한 글인지 2~4문장으로 설명한 주제·맥락" },
    marketerInsight: {
      type: "array",
      items: { type: "string" },
      description: "반도체 마케터·AI 동향 관점에서의 시사점·읽을 가치 (3~5개)",
    },
    sections: {
      type: "array",
      description: "원문의 흐름을 따라 구조화한 충실한 한글 정리 (요약이 아니라 원문 의도를 살린 번역·정리)",
      items: {
        type: "object",
        properties: {
          heading: { type: "string", description: "소제목" },
          content: { type: "string", description: "해당 부분의 한글 본문 (맥락 손실 최소화)" },
        },
        required: ["heading", "content"],
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
  required: ["koreanTitle", "originalTitle", "oneLiner", "topic", "marketerInsight", "sections", "keyTerms"],
  additionalProperties: false,
};

const SYSTEM = `너는 영어 장문 자료를 한국어로 옮겨 주는 전문 에디터다.
독자는 SK하이닉스의 반도체 마케터이며, AI 산업 동향에 관심이 많다.

원칙:
- 번역은 원문의 의도와 뉘앙스에 충실하게, 맥락 손실을 최소화한다. 임의로 줄이거나 왜곡하지 않는다.
- sections는 "요약"이 아니라 원문 흐름을 따라간 충실한 한글 정리다. 중요한 논지·근거·숫자·사례를 빠뜨리지 않는다.
- oneLiner와 topic은 글의 본질을 증류해 한눈에 파악하게 한다.
- marketerInsight는 독자 페르소나(반도체/AI 마케터) 관점에서 "왜 읽을 가치가 있는지, 우리 산업·마케팅에 어떤 함의가 있는지"를 짚는다. 원문에 없는 사실을 지어내지 말고, 원문 내용에 근거해 연결한다.
- 전문 용어는 자연스러운 한국어로 옮기되, 필요하면 영문 원어를 괄호로 병기한다.
- 모든 출력은 한국어로 작성한다(originalTitle 제외).`;

/**
 * @param {string} text - 원문 본문
 * @param {{url?: string, sourceTitle?: string}} [meta]
 */
export async function distillArticle(text, { url = "", sourceTitle = "" } = {}) {
  const header = [sourceTitle && `원문 제목: ${sourceTitle}`, url && `출처: ${url}`]
    .filter(Boolean)
    .join("\n");

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: `${header}\n\n아래 영어 본문을 위 원칙에 따라 한글로 번역·구조화·증류해줘.\n\n---\n${text}`,
      },
    ],
  });

  const block = message.content.find((b) => b.type === "text");
  if (!block) throw new Error("Claude 응답에서 결과를 찾지 못했습니다.");
  return JSON.parse(block.text);
}
