# 📦 인수인계: 회의록 정리 시스템 (녹음·영상·PDF)

> 이 문서는 `PRIMITIVE_WEB` 프로젝트가 **"영문 링크 → 한글 증류 리더"** 로 방향을 바꾸면서,
> 그동안 구현했던 **녹음·영상·PDF 정리 시스템** 을 다른 세션에서 이어가기 위해 정리한 인수인계 노트입니다.
> 아래 내용 전체를 새 세션에 그대로 붙여넣으면 작업을 이어갈 수 있습니다.

## 1. 무엇을 만들었나

녹음/영상/PDF를 입력하면 **받아쓰기 → 요약 → 항목별 정리(안건·결정·할 일)** 를 자동 생성하고,
브라우저 보관함에 저장·검색하는 웹앱.

| 입력 | 처리 | 도구 |
| --- | --- | --- |
| 🎙️ 녹음·영상 (아이폰 `.m4a`, mp3, mp4, mov) | 받아쓰기 (25MB 초과 시 자동 분할) | OpenAI Whisper + `ffmpeg-static` |
| 🎬 유튜브 링크 | 자막 추출 | `youtube-transcript` |
| 📄 PDF·논문 | 직접 읽어 정리 | Claude `claude-opus-4-8` |

## 2. 코드 위치

이 시스템의 **전체 소스 코드는 git 히스토리에 보존**되어 있습니다.

- 브랜치: `claude/unclear-request-plepdz`
- 커밋: **`40eff78`** (커밋 메시지: "회의록 정리 시스템 구현 …")
- PR: orcus07/PRIMITIVE_WEB **#2** (구버전 설명 포함)

새 세션/저장소에서 코드를 꺼내려면:
```bash
git show 40eff78:src/server.js
git show 40eff78:src/lib/transcribe.js
git show 40eff78:src/lib/youtube.js
git show 40eff78:src/lib/summarize.js
git show 40eff78:public/index.html
git show 40eff78:public/style.css
git show 40eff78:public/app.js
# 또는 그 커밋 전체를 체크아웃:  git checkout 40eff78 -- .
```

## 3. 아키텍처 요약

```
src/server.js          Express 서버
  POST /api/process/media     음성/영상 파일 → transcribeMedia → summarizeText
  POST /api/process/youtube   유튜브 URL → fetchYoutubeTranscript → summarizeText
  POST /api/process/document  PDF → summarizePdf
  GET  /api/health            API 키 설정 여부 반환
src/lib/transcribe.js  Whisper 받아쓰기. 24MB 초과 시 ffmpeg로 600초 단위 분할 후 이어붙임
src/lib/youtube.js     youtube-transcript로 자막 추출 (한국어 우선)
src/lib/summarize.js   Claude claude-opus-4-8 + 구조화 출력(json_schema)
                       → { title, summary, keyPoints, decisions, actionItems }
public/                탭 UI(녹음/유튜브/PDF) + 결과 표시 + localStorage 보관함·검색
```

핵심 구현 포인트:
- API 키 없이도 서버가 부팅되도록 SDK 클라이언트를 **지연 생성**(`client()` 게터)
- Whisper 25MB 한도 대응을 위해 **ffmpeg-static**로 자동 분할 (시스템 ffmpeg 설치 불필요)
- 필요한 키: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`

## 4. 실행 방법

```bash
npm install
cp .env.example .env   # ANTHROPIC_API_KEY, OPENAI_API_KEY 입력
npm start              # http://localhost:3000
```

## 5. 남은 일 / 다음 단계 (TODO)

- [ ] 자막 없는 유튜브 영상 지원 (오디오 다운로드 → Whisper). `yt-dlp` 또는 `ytdl-core` 필요
- [ ] 결과를 PDF/워드로 내보내기
- [ ] 여러 기기 공유를 위한 DB(예: SQLite/Supabase) + 인터넷 배포
- [ ] 화자 분리(speaker diarization) — 누가 말했는지 구분
- [ ] 받아쓰기 진행률 표시(스트리밍)
- [ ] 실제 API 키로 종단 테스트 (현재 샌드박스에선 키·네트워크 제약으로 미검증)

## 6. 검증 상태

- 모든 JS 구문 검사 통과
- 키 없이 서버 부팅 / `/api/health` / 정적 UI / 입력 검증 동작 확인
- 실제 받아쓰기·요약 호출은 API 키 필요 → 로컬에서 키 입력 후 검증 필요
