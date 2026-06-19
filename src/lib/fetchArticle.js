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
  if (text.length < 400) throw new Error("direct too short");
  return { title, text, via: "direct" };
}

async function tryProxy(url) {
  // Jina Reader는 보호된 페이지도 깔끔한 마크다운/텍스트로 돌려준다.
  const res = await fetch(PROXY + url, {
    headers: { "Accept-Language": "en-US,en;q=0.9", "X-Return-Format": "text" },
  });
  if (!res.ok) throw new Error(`proxy ${res.status}`);
  const text = (await res.text()).trim();
  if (text.length < 400) throw new Error("proxy too short");
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
  return { title: `${name} (@${handle}) 트윗`, text, via: "tweet" };
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
  return { title: data.author_name ? `${data.author_name} 트윗` : "트윗", text, via: "tweet" };
}

/**
 * URL에서 { title, text, via }를 반환. 모든 전략 실패 시 에러를 던진다.
 * @param {string} url
 */
export async function fetchArticle(url) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("올바른 http(s) 링크를 입력해주세요.");
  }

  // 트윗이면 트윗 전용 전략을 먼저 시도한다.
  const strategies = isTweet(url)
    ? [tryTweetFx, tryTweetOembed, tryProxy]
    : [tryDirect, tryProxy];

  const errors = [];
  for (const strategy of strategies) {
    try {
      return await strategy(url);
    } catch (e) {
      errors.push(e.message);
    }
  }

  const hint = isTweet(url)
    ? `긴 스레드는 첫 트윗만 받아오거나 막힐 수 있어요. 트윗 본문을 복사해 "본문 붙여넣기"로 넣어주세요.`
    : `봇 차단이 강한 사이트일 수 있어요. 원문 본문을 복사해서 "본문 붙여넣기"로 넣어주세요.`;
  throw new Error(`이 링크의 본문을 가져오지 못했습니다 (${errors.join(", ")}). ${hint}`);
}
