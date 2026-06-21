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

// 1순위: fxtwitter 공개 API (깔끔한 JSON, 인용 트윗까지)
async function tryTweetFx(url) {
  const id = url.match(TWEET_RE)[2];
  const res = await fetch(`https://api.fxtwitter.com/status/${id}`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`tweet-fx ${res.status}`);
  const data = await res.json();
  const t = data && data.tweet;
  if (!t || !t.text) throw new Error("tweet-fx empty");
  let text = t.text;
  if (t.quote && t.quote.text) {
    text += `\n\n[인용한 트윗 - @${(t.quote.author && t.quote.author.screen_name) || ""}]\n${t.quote.text}`;
  }
  const handle = (t.author && t.author.screen_name) || url.match(TWEET_RE)[1];
  const name = (t.author && t.author.name) || handle;
  return { title: `${name} (@${handle}) 트윗`, text, via: "tweet", handle: `@${handle}` };
}

// 2순위: 공식 oEmbed (첫 트윗 텍스트)
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
async function resolveUrl(shortUrl) {
  try {
    const res = await fetch(shortUrl, { headers: BROWSER_HEADERS, redirect: "follow" });
    return res.url || shortUrl;
  } catch {
    return shortUrl;
  }
}

// 일반 기사 수집(프록시 먼저 — JS/차단 사이트에 강함, 그다음 직접). 실패하면 null.
async function fetchLinkedArticle(u) {
  for (const s of [tryProxy, tryDirect]) {
    try {
      return await s(u);
    } catch {
      /* 다음 전략 */
    }
  }
  return null;
}

// 트윗을 가져오되, 본문이 거의 없고 링크만 공유한 트윗이면
// 그 링크를 따라가 실제 글 본문을 읽어온다.
async function fetchTweet(url) {
  const errors = [];
  let tweet;
  for (const s of [tryTweetFx, tryTweetOembed, tryProxy]) {
    try {
      tweet = await s(url);
      break;
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (!tweet) {
    throw new Error(
      `트윗을 가져오지 못했어요 (${errors.join(", ")}). 보호된/삭제된 트윗이거나 일시적 차단일 수 있어요. ` +
        `트윗 본문을 복사해 "본문 붙여넣기"로 넣어주세요.`
    );
  }
  tweet.url = url; // 기본: 원문 열기 = 트윗 URL

  const urls = tweet.text.match(/https?:\/\/[^\s]+/g) || [];
  const textNoUrls = tweet.text.replace(/https?:\/\/[^\s]+/g, "").replace(/\s+/g, " ").trim();

  // 텍스트가 짧고 링크가 있으면 = 링크 공유 트윗 → 그 링크 본문을 읽는다.
  if (urls.length && textNoUrls.length < 200) {
    const shared = await resolveUrl(urls[urls.length - 1]);
    if (!isTweet(shared) && /^https?:\/\//i.test(shared)) {
      const who = tweet.handle || "트윗";
      const art = await fetchLinkedArticle(shared);
      if (art && art.text) {
        return {
          title: art.title || tweet.title,
          text: `[${who} 가 공유한 링크: ${shared}]\n\n${art.text}`,
          via: "tweet",
          url: shared, // 원문 열기 = 실제 목적지 글
        };
      }
      // 본문 자동 수집 실패: 적어도 펼친 목적지 URL을 안내해 바로 붙여넣게 한다.
      throw new Error(
        `이 트윗은 링크 공유 트윗이에요. 공유된 글의 본문을 자동으로 못 가져왔어요.\n` +
          `→ 공유된 실제 글: ${shared}\n` +
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
export async function fetchArticle(url) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("올바른 http(s) 링크를 입력해주세요.");
  }

  // 트윗이면 트윗 전용 처리(필요 시 공유 링크 추적). fetchTweet이 안내 메시지를 던진다.
  if (isTweet(url)) {
    return await fetchTweet(url);
  }

  const errors = [];
  for (const strategy of [tryDirect, tryProxy]) {
    try {
      const r = await strategy(url);
      return { ...r, url }; // 원문 열기용 URL 동봉
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw new Error(
    `이 링크의 본문을 가져오지 못했습니다 (${errors.join(", ")}). ` +
      `봇 차단이 강한 사이트일 수 있어요. 원문 본문을 복사해서 "본문 붙여넣기"로 넣어주세요.`
  );
}
