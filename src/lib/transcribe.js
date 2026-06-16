// 음성/영상 파일을 텍스트로 받아쓰기 (OpenAI Whisper).
// 아이폰 .m4a 같은 큰 파일은 Whisper의 25MB 제한에 걸리므로,
// ffmpeg로 일정 시간 단위로 잘라서 순서대로 받아쓴 뒤 이어붙입니다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

ffmpeg.setFfmpegPath(ffmpegPath);

// 키가 없어도 서버는 뜨도록, 클라이언트는 실제 사용할 때 만든다.
let _openai;
function client() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY 가 설정되지 않았습니다. .env 파일을 확인해주세요.");
  }
  return (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}

// Whisper 한도는 25MB. 안전하게 24MB를 넘으면 분할한다.
const MAX_BYTES = 24 * 1024 * 1024;
// 분할 시 한 조각의 길이(초). 1시간 회의를 ~10분 단위로 나눈다.
const CHUNK_SECONDS = 600;

function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format?.duration ?? 0);
    });
  });
}

// 원본을 [start, start+CHUNK_SECONDS] 구간의 압축 m4a로 추출.
// 모노 + 낮은 비트레이트로 재인코딩해 용량도 크게 줄인다.
function extractSegment(input, output, start, seconds) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .setStartTime(start)
      .duration(seconds)
      .noVideo()
      .audioChannels(1)
      .audioBitrate("64k")
      .audioCodec("aac")
      .format("mp4")
      .on("end", () => resolve(output))
      .on("error", reject)
      .save(output);
  });
}

async function whisper(filePath) {
  const res = await client().audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "whisper-1",
    response_format: "text",
  });
  return typeof res === "string" ? res : res.text ?? "";
}

/**
 * 음성/영상 파일을 받아쓰기한 전체 텍스트(스크립트)를 반환.
 * @param {string} filePath - 업로드된 파일 경로
 * @returns {Promise<string>}
 */
export async function transcribeMedia(filePath) {
  const { size } = fs.statSync(filePath);

  // 작은 파일은 그대로 한 번에 받아쓰기.
  if (size <= MAX_BYTES) {
    return (await whisper(filePath)).trim();
  }

  // 큰 파일: 시간 단위로 잘라서 순차 처리.
  const duration = await probeDuration(filePath);
  const tmpDir = path.join(os.tmpdir(), `transcribe-${randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const parts = [];
  try {
    for (let start = 0; start < duration; start += CHUNK_SECONDS) {
      const seg = path.join(tmpDir, `seg-${start}.m4a`);
      await extractSegment(filePath, seg, start, CHUNK_SECONDS);
      const text = await whisper(seg);
      if (text.trim()) parts.push(text.trim());
      fs.rmSync(seg, { force: true });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return parts.join("\n");
}
