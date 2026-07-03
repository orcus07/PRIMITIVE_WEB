// 영문 아티클 URL에서 본문 텍스트를 가져온다.
// 봇 차단 사이트가 많으므로 여러 전략을 순서대로 시도한다:
//   1) 브라우저처럼 직접 요청  →  2) 리더 프록시(Jina) 우회  →  실패 시 안내
import { parse } from "node-html-parser";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const PROXY = process.env.READER_PROXY || "https://r.jina.ai/";

// 전략 함수 이름 → 사람이 읽을 한글 라벨 (진행 로그용)
const LABEL = {
  tryDirect: "직접 수집",
  tryProxy: "프록시(Jina) 우회",
  tryTweetFx: "fxtwitter API",
  tryTweetVx: "vxtwitter API",
  tryTweetSyndication: "X 임베드 API",
  tryTweetOembed: "트위터 oEmbed",
};
const labelOf = (fn) => LABEL[fn.name] || fn.name;

// X(트위터)가 로그인/가입을 요구하며 내놓는 장벽 페이지인지 판별.
// 프록시가 트윗 대신 이 화면을 긁어오면 "가짜 본문"이 되므로 걸러낸다.
function looksLikeXLoginWall(text) {
  const t = text.slice(0, 2000).toLowerCase();
  const marks = [
    "log in", "sign up", "don't miss what's happening",
    "see new posts", "something went wrong", "try reloading",
    "javascript is not available",
  ];
  const hits = marks.filter((s) => t.includes(s)).length;
  return hits >= 2;
}

// HTML에서 잡음(script/style/nav 등)을 걷어내고 제목 + 본문 텍스트만 남긴다.
function htmlToText(html) {
  const root = parse(html, { blockTextElements: { script: false, style: false } });
  root.querySelectorAll("script,style,noscript,nav,footer,header,aside,svg,form")
    .forEach((el) => el.remove());

  const title =
    root.querySelector("title")?.text?.trim() ||
    root.querySelector("h1")?.text?.trim() ||
    "";

  // 본문 후보: <article> 우선, 없으면 <main>, 없으면 <body>
  const container =
    root.querySelector("article") || root.querySelector("main") || root.querySelector("body") || root;
  const text = container.text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  return { title, text };
}

async function tryDirect(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`direct ${res.status}`);
  const html = await res.text();
  const { title, text } = htmlToText(html);
  if (text.length < 250) throw new Error("direct too short");
  return { title, text, via: "direct" };
}

async function tryProxy(url) {
  // Jina Reader는 보호된 페이지도 깔끔한 마크다운/텍스트로 돌려준다.
  const res = await fetch(PROXY + url, {
    headers: { "Accept-Language": "en-US,en;q=0.9", "X-Return-Format": "text" },
  });
  if (!res.ok) throw new Error(`proxy ${res.status}`);
  const text = (await res.text()).trim();
  if (text.length < 250) throw new Error("proxy too short");
  // 프록시 응답 첫 줄이 "Title:" 형태인 경우가 많아 분리해 둔다.
  const m = text.match(/^Title:\s*(.+)$/m);
  return { title: m ? m[1].trim() : "", text, via: "proxy" };
}

/**
 * URL에서 { title, text, via }를 반환. 모든 전략 실패 시 에러를 던진다.
 * @param {string} url
 */
// ── X(트위터) 전용 수집 ──────────────────────────────────────────
// 트윗은 로그인·JS·봇차단으로 일반 fetch가 막힌다. 텍스트만 주는 공개 API로 우회.
const TWEET_RE = /(?:twitter\.com|x\.com)\/([^/?#]+)\/status\/(\d+)/i;
const isTweet = (url) => TWEET_RE.test(url);

// ── X 아티클(프리미엄 장문 글) ─────────────────────────────────
// x.com/i/article/<id> 형태. 로그인 장벽 뒤라 일반 수집이 막히므로
// 트윗 미러 API들이 응답에 실어주는 article 데이터를 최대한 활용한다.
const ARTICLE_RE = /(?:twitter\.com|x\.com)\/(?:i|[^/?#]+)\/article\/(\d+)/i;
const isXArticle = (url) => ARTICLE_RE.test(url);

// 미러 API 응답의 article 객체에서 본문 텍스트를 뽑아낸다.
// API마다 필드가 달라(text / blocks / content_state…) 방어적으로 훑는다.
function articleToText(a) {
  if (!a || typeof a !== "object") return "";
  const fromBlocks = (blocks) =>
    Array.isArray(blocks)
      ? blocks.map((b) => (b && (b.text || b.content)) || "").filter(Boolean).join("\n\n")
      : "";
  const body =
    (typeof a.text === "string" && a.text) ||
    (typeof a.full_text === "string" && a.full_text) ||
    (typeof a.content === "string" && a.content) ||
    fromBlocks(a.blocks) ||
    fromBlocks(a.content_state && a.content_state.blocks) ||
    "";
  const parts = [];
  if (a.title) parts.push(a.title);
  if (body) parts.push(body);
  else if (a.preview_text) {
    parts.push(`${a.preview_text}\n\n…(공개된 건 미리보기까지라 전문은 가져오지 못했습니다)`);
  }
  return parts.join("\n\n").trim();
}

// 아티클 ID를 status로 간주해 미러 API들에 물어본다. 성공 시 { title, text }, 실패 시 null.
async function tryXArticle(articleUrl, onProgress = () => {}) {
  const id = articleUrl.match(ARTICLE_RE)[1];
  const attempts = [
    ["fxtwitter API", `https://api.fxtwitter.com/status/${id}`, (d) => d && d.tweet],
    ["vxtwitter API", `https://api.vxtwitter.com/i/status/${id}`, (d) => d],
  ];
  for (const [label, api, pick] of attempts) {
    onProgress(`X 아티클 ${label} 조회…`);
    try {
      const res = await fetch(api, { headers: BROWSER_HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const t = pick(await res.json());
      const artText = articleToText(t && t.article);
      const text = artText || (t && t.text) || "";
      if (text.length < 250) throw new Error("본문 없음/너무 짧음");
      onProgress(`✓ X 아티클 본문 확보 (${text.length.toLocaleString()}자)`);
      return { title: (t.article && t.article.title) || "", text };
    } catch (e) {
      onProgress(`✗ X 아티클 ${label} 실패: ${e.message}`);
    }
  }
  return null;
}

// 1순위: fxtwitter 공개 API (깔끔한 JSON, 인용 트윗까지)
async function tryTweetFx(url) {
  const id = url.match(TWEET_RE)[2];
  const res = await fetch(`https://api.fxtwitter.com/status/${id}`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`tweet-fx ${res.status}`);
  const data = await res.json();
  const t = data && data.tweet;
  const artText = t ? articleToText(t.article) : "";
  if (!t || (!t.text && !artText)) throw new Error("tweet-fx empty");
  let text = t.text || "";
  if (t.quote && t.quote.text) {
    text += `\n\n[인용한 트윗 - @${(t.quote.author && t.quote.author.screen_name) || ""}]\n${t.quote.text}`;
  }
  // 트윗에 X 아티클(장문 글)이 붙어 있으면 그 본문까지 함께 싣는다.
  if (artText && !text.includes(artText)) {
    text = text ? `${text}\n\n[첨부된 X 아티클]\n${artText}` : artText;
  }
  const handle = (t.author && t.author.screen_name) || url.match(TWEET_RE)[1];
  const name = (t.author && t.author.name) || handle;
  return { title: `${name} (@${handle}) 트윗`, text, via: "tweet", handle: `@${handle}` };
}

// 2순위: vxtwitter 공개 API — fxtwitter와 별개 인프라라 한쪽이 막혀도 교차 보완
async function tryTweetVx(url) {
  const id = url.match(TWEET_RE)[2];
  const res = await fetch(`https://api.vxtwitter.com/i/status/${id}`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`tweet-vx ${res.status}`);
  const data = await res.json();
  const artText = data ? articleToText(data.article) : "";
  if (!data || (!data.text && !artText)) throw new Error("tweet-vx empty");
  let text = data.text || "";
  if (data.qrt && data.qrt.text) {
    text += `\n\n[인용한 트윗 - @${data.qrt.user_screen_name || ""}]\n${data.qrt.text}`;
  }
  if (artText && !text.includes(artText)) {
    text = text ? `${text}\n\n[첨부된 X 아티클]\n${artText}` : artText;
  }
  const handle = data.user_screen_name || url.match(TWEET_RE)[1];
  const name = data.user_name || handle;
  return { title: `${name} (@${handle}) 트윗`, text, via: "tweet", handle: `@${handle}` };
}

// 3순위: X 공식 임베드(신디케이션) API — 위젯이 쓰는 경로라 인증 없이 트윗 JSON을 준다.
// 토큰은 위젯과 같은 공개 규칙으로 계산한다.
function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}
async function tryTweetSyndication(url) {
  const id = url.match(TWEET_RE)[2];
  const api = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${syndicationToken(id)}`;
  const res = await fetch(api, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`tweet-synd ${res.status}`);
  const data = await res.json();
  if (!data || data.__typename === "TweetTombstone" || !data.text) throw new Error("tweet-synd empty");
  let text = data.text;
  if (data.quoted_tweet && data.quoted_tweet.text) {
    text += `\n\n[인용한 트윗 - @${(data.quoted_tweet.user && data.quoted_tweet.user.screen_name) || ""}]\n${data.quoted_tweet.text}`;
  }
  const handle = (data.user && data.user.screen_name) || url.match(TWEET_RE)[1];
  const name = (data.user && data.user.name) || handle;
  return { title: `${name} (@${handle}) 트윗`, text, via: "tweet", handle: `@${handle}` };
}

// 4순위: 공식 oEmbed (첫 트윗 텍스트)
async function tryTweetOembed(url) {
  const api = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true&dnt=true`;
  const res = await fetch(api, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`tweet-oembed ${res.status}`);
  const data = await res.json();
  if (!data || !data.html) throw new Error("tweet-oembed empty");
  const text = parse(data.html).text.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("tweet-oembed no text");
  const handle = (url.match(TWEET_RE) || [])[1];
  return { title: data.author_name ? `${data.author_name} 트윗` : "트윗", text, via: "tweet", handle: handle ? `@${handle}` : "" };
}

// 단축 링크(t.co 등)를 최종 목적지 URL로 펼친다.
// Location 헤더를 직접 따라가며 최대 5홉까지 펼친다(res.url에만 의존하지 않음).
async function resolveUrl(shortUrl) {
  let current = shortUrl;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(current, { headers: BROWSER_HEADERS, redirect: "manual" });
      const loc = res.headers.get("location");
      if (loc) { current = new URL(loc, current).href; continue; }
      // 더 이상 리다이렉트 없음 → 최종 URL
      return res.url && res.url !== "about:blank" ? res.url : current;
    } catch {
      return current;
    }
  }
  return current;
}

// 일반 기사 수집(프록시 먼저 — JS/차단 사이트에 강함, 그다음 직접). 실패하면 null.
// 로그인 장벽(X 등) 페이지만 긁힌 경우는 가짜 본문이므로 실패로 처리한다.
async function fetchLinkedArticle(u, onProgress = () => {}) {
  for (const s of [tryProxy, tryDirect]) {
    onProgress(`공유 링크 본문 ${labelOf(s)} 시도…`);
    try {
      const r = await s(u);
      if (looksLikeXLoginWall(r.text)) {
        onProgress(`✗ ${labelOf(s)}: 로그인 장벽 페이지만 수집됨(무시)`);
        continue;
      }
      onProgress(`✓ 공유 링크 본문 확보 (${r.text.length.toLocaleString()}자)`);
      return r;
    } catch (e) {
      onProgress(`✗ ${labelOf(s)} 실패: ${e.message}`);
    }
  }
  return null;
}

// 트윗을 가져오되, 본문이 거의 없고 링크만 공유한 트윗이면
// 그 링크를 따라가 실제 글 본문을 읽어온다.
async function fetchTweet(url, onProgress = () => {}) {
  const errors = [];
  let tweet;
  for (const s of [tryTweetFx, tryTweetVx, tryTweetSyndication, tryTweetOembed, tryProxy]) {
    onProgress(`트윗 ${labelOf(s)} 시도…`);
    try {
      const r = await s(url);
      // 프록시가 트윗 대신 X 로그인 장벽을 긁어왔다면 가짜 본문이므로 거부.
      if (s === tryProxy && looksLikeXLoginWall(r.text)) {
        throw new Error("X 로그인 장벽 페이지만 수집됨");
      }
      tweet = r;
      onProgress(`✓ ${labelOf(s)} 성공`);
      break;
    } catch (e) {
      errors.push(`${labelOf(s)}: ${e.message}`);
      onProgress(`✗ ${labelOf(s)} 실패: ${e.message}`);
    }
  }
  if (!tweet) {
    throw new Error(
      `트윗을 가져오지 못했어요 (${errors.join(", ")}). 보호된/삭제된 트윗이거나 일시적 차단일 수 있어요. ` +
        `트윗 본문을 복사해 "본문 붙여넣기"로 넣어주세요.`
    );
  }
  tweet.url = url; // 기본: 원문 열기 = 트윗 URL

  // URL 뒤에 공백 없이 붙은 꼬리 문자(엠대시·따옴표·괄호·구두점 등)를 떼어낸다.
  // 예: "https://t.co/abc—" → "https://t.co/abc"
  const cleanUrl = (u) => u.replace(/[‐-―‘-‟….,;:!?'"()[\]{}<>]+$/u, "");
  const urls = (tweet.text.match(/https?:\/\/[^\s]+/g) || []).map(cleanUrl);
  const textNoUrls = tweet.text.replace(/https?:\/\/[^\s]+/g, "").replace(/\s+/g, " ").trim();

  // 텍스트가 짧고 링크가 있으면 = 링크 공유 트윗 → 그 링크 본문을 읽는다.
  if (urls.length && textNoUrls.length < 200) {
    onProgress(`링크 공유 트윗 감지 — 단축 링크 펼치는 중…`);
    const shared = await resolveUrl(urls[urls.length - 1]);
    if (!isTweet(shared) && /^https?:\/\//i.test(shared)) {
      onProgress(`공유 링크 목적지: ${shared}`);
      const who = tweet.handle || "트윗";
      // 공유 링크가 X 아티클(장문 글)이면 미러 API로 본문을 먼저 시도한다.
      if (isXArticle(shared)) {
        onProgress("공유 링크가 X 아티클(장문 글) — 미러 API로 본문 수집 시도");
        const xa = await tryXArticle(shared, onProgress);
        if (xa) {
          return {
            title: xa.title || tweet.title,
            text: `[${who} 가 공유한 X 아티클: ${shared}]\n\n${xa.text}`,
            via: "tweet",
            url: shared,
          };
        }
      }
      const art = await fetchLinkedArticle(shared, onProgress);
      if (art && art.text) {
        return {
          title: art.title || tweet.title,
          text: `[${who} 가 공유한 링크: ${shared}]\n\n${art.text}`,
          via: "tweet",
          url: shared, // 원문 열기 = 실제 목적지 글
        };
      }
      // 공유 링크 본문 자동 수집 실패(로그인 장벽 등).
      // 트윗 본인 코멘트가 의미 있게 있으면 그걸로 폴백(없는 내용 지어내지 않음).
      if (textNoUrls.length >= 30) {
        onProgress("✗ 공유 링크 본문 수집 실패 — 트윗 자체 코멘트로 폴백");
        return {
          title: tweet.title,
          text:
            `[참고: 이 트윗이 공유한 링크(${shared})의 본문은 로그인 장벽 등으로 ` +
            `자동 수집하지 못했습니다. 아래는 트윗 자체 내용입니다.]\n\n${tweet.text}`,
          via: "tweet",
          url: shared, // 원문 열기 = 공유 링크
        };
      }
      // 코멘트도 거의 없는 순수 링크 공유 → 정직하게 붙여넣기 안내.
      throw new Error(
        isXArticle(shared)
          ? `이 트윗이 공유한 건 X 아티클(프리미엄 장문 글)이에요. 로그인 장벽에 막혀 ` +
            `우회 경로까지 모두 실패해 본문을 자동으로 가져오지 못했습니다.\n` +
            `→ 아티클: ${shared}\n` +
            `X 앱/웹에서 아티클을 열어 본문을 복사한 뒤 "본문 붙여넣기"(원문 링크 칸에 위 주소)로 넣으면 정확히 정리해드려요.`
          : `이 트윗은 X(트위터) 안에서 로그인해야 보이는 콘텐츠를 공유한 것 같아요. ` +
            `공유된 글의 본문을 자동으로 가져오지 못했습니다.\n` +
            `→ 공유 링크: ${shared}\n` +
            `이 링크를 열어 본문을 복사한 뒤 "본문 붙여넣기"(원문 링크 칸에 위 주소)로 넣으면 정확히 정리해드려요.`
      );
    }
  }
  return tweet;
}

/**
 * URL에서 { title, text, via }를 반환. 모든 전략 실패 시 에러를 던진다.
 * @param {string} url
 */
export async function fetchArticle(url, onProgress = () => {}) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("올바른 http(s) 링크를 입력해주세요.");
  }

  // X 아티클 링크를 직접 넣은 경우 — 미러 API 먼저, 실패하면 일반 전략으로 계속.
  if (isXArticle(url)) {
    onProgress("X 아티클(장문 글) 링크 감지 — 미러 API로 본문 수집 시도");
    const xa = await tryXArticle(url, onProgress);
    if (xa) return { title: xa.title, text: xa.text, via: "tweet", url };
    onProgress("✗ 미러 API 모두 실패 — 일반 수집 전략으로 계속");
  }

  // 트윗이면 트윗 전용 처리(필요 시 공유 링크 추적). fetchTweet이 안내 메시지를 던진다.
  if (isTweet(url)) {
    onProgress("X(트위터) 링크 감지 — 트윗 전용 수집 시작");
    return await fetchTweet(url, onProgress);
  }

  const errors = [];
  for (const strategy of [tryDirect, tryProxy]) {
    onProgress(`${labelOf(strategy)} 시도…`);
    try {
      const r = await strategy(url);
      // X 도메인은 로그인 장벽 페이지가 "본문"으로 긁혀올 수 있어 걸러낸다.
      if (/(?:twitter|x)\.com\//i.test(url) && looksLikeXLoginWall(r.text)) {
        throw new Error("X 로그인 장벽 페이지만 수집됨");
      }
      onProgress(`✓ ${labelOf(strategy)} 성공 (${r.text.length.toLocaleString()}자)`);
      return { ...r, url }; // 원문 열기용 URL 동봉
    } catch (e) {
      errors.push(e.message);
      onProgress(`✗ ${labelOf(strategy)} 실패: ${e.message}`);
    }
  }
  throw new Error(
    `이 링크의 본문을 가져오지 못했습니다 (${errors.join(", ")}). ` +
      `봇 차단이 강한 사이트일 수 있어요. 원문 본문을 복사해서 "본문 붙여넣기"로 넣어주세요.`
  );
}
