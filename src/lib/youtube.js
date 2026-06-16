// 유튜브 영상에서 자막(스크립트)을 추출한다.
// 자막이 있는 영상이면 다운로드 없이 빠르게 텍스트를 얻는다.
import { YoutubeTranscript } from "youtube-transcript";

// 다양한 유튜브 URL 형태에서 영상 ID만 뽑아낸다.
export function parseVideoId(url) {
  if (!url) return null;
  // 이미 11자리 ID만 들어온 경우
  if (/^[\w-]{11}$/.test(url)) return url;
  const patterns = [
    /[?&]v=([\w-]{11})/,        // youtube.com/watch?v=ID
    /youtu\.be\/([\w-]{11})/,   // youtu.be/ID
    /\/embed\/([\w-]{11})/,     // /embed/ID
    /\/shorts\/([\w-]{11})/,    // /shorts/ID
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * 유튜브 자막을 하나의 텍스트로 반환.
 * @param {string} url - 유튜브 링크 또는 영상 ID
 * @returns {Promise<string>}
 */
export async function fetchYoutubeTranscript(url) {
  const videoId = parseVideoId(url);
  if (!videoId) {
    throw new Error("유튜브 링크에서 영상 ID를 찾지 못했습니다. 링크를 확인해주세요.");
  }

  let items;
  try {
    // 한국어 자막 우선, 없으면 기본 자막.
    items = await YoutubeTranscript.fetchTranscript(videoId, { lang: "ko" })
      .catch(() => YoutubeTranscript.fetchTranscript(videoId));
  } catch {
    throw new Error(
      "이 영상에는 사용할 수 있는 자막이 없습니다. (자막 없는 영상은 현재 버전에서 지원되지 않아요)"
    );
  }

  const text = items.map((i) => i.text).join(" ").replace(/\s+/g, " ").trim();
  if (!text) {
    throw new Error("자막을 가져왔지만 내용이 비어 있습니다.");
  }
  return text;
}
