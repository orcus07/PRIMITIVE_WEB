# 🧠 회의록 정리 시스템 (Meeting Digest)

녹음·영상·문서를 던지면 **받아쓰기 → 핵심 요약 → 항목별 정리(안건·결정·할 일)** 까지
자동으로 만들어 주는 도구입니다. 정리한 결과는 브라우저 보관함에 저장되고 검색할 수 있어요.

## 무엇을 처리하나요?

| 입력 | 처리 | 결과 |
| --- | --- | --- |
| 🎙️ 녹음·영상 (아이폰 `.m4a`, mp3, mp4, mov…) | Whisper로 받아쓰기 (큰 파일은 자동 분할) | 전체 스크립트 + 요약 + 항목별 정리 |
| 🎬 유튜브 링크 | 자막 추출 | 자막 + 요약 + 항목별 정리 |
| 📄 PDF·논문 | Claude가 직접 읽기 | 요약 + 항목별 정리 |

- **요약·정리**: Claude (`claude-opus-4-8`)
- **음성→텍스트**: OpenAI Whisper

## 준비물

1. **Node.js 20 이상** — https://nodejs.org
2. **API 키 2개**
   - `ANTHROPIC_API_KEY` — https://console.anthropic.com (요약용)
   - `OPENAI_API_KEY` — https://platform.openai.com (받아쓰기용)

> 음성 분할에 필요한 ffmpeg는 `ffmpeg-static` 패키지에 포함되어 **따로 설치할 필요가 없습니다.**

## 실행 방법

```bash
# 1) 의존성 설치
npm install

# 2) 환경설정 파일 만들고 키 입력
cp .env.example .env
#   → .env 파일을 열어 ANTHROPIC_API_KEY, OPENAI_API_KEY 채우기

# 3) 서버 실행
npm start

# 4) 브라우저에서 열기
#   http://localhost:3000
```

## 사용법

1. 브라우저에서 탭(녹음·영상 / 유튜브 / PDF) 선택
2. 파일 업로드 또는 유튜브 링크 입력 → **정리 시작**
3. 잠시 후 요약·항목별 정리·전체 받아쓰기가 표시되고, 왼쪽 보관함에 저장됨
4. 보관함에서 검색하거나 지난 기록을 다시 열어볼 수 있어요

## 비용 안내

받아쓰기와 요약은 API 사용량만큼 과금됩니다 (대략 1시간 분량 처리 시 수백 원 수준).
실제 비용은 Anthropic / OpenAI 콘솔에서 확인하세요.

## 파일 구성

```
src/
  server.js          서버 (입력 → 처리 → 결과)
  lib/transcribe.js  음성·영상 받아쓰기 (Whisper + 자동 분할)
  lib/youtube.js     유튜브 자막 추출
  lib/summarize.js   Claude 요약·항목별 정리
public/
  index.html / style.css / app.js   화면(UI) + 보관함
```

## 한계 / 참고

- 유튜브는 **자막이 있는 영상**만 지원합니다 (자막 없는 영상은 추후 음성 다운로드 처리 예정).
- 업로드 파일은 처리 후 서버에서 삭제됩니다. 보관함 데이터는 브라우저(localStorage)에만 저장됩니다.
- 받아쓰기 1개 파일은 25MB 제한이 있어 큰 파일은 자동으로 10분 단위로 나눠 처리합니다.
