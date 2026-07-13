# 형제 레포 벤치마크 — PRIMITIVE_WEB vs sv-explorer · IR-Analysis · Mybots

> 작성일: 2026-07-12 · 비교 기준: **1인 운영 소형 웹앱(Render 무료 티어) 규모에 맞는가**.
> 더 정교하다는 이유만으로 채택하지 않는다. 근거는 각 레포의 파일 경로로 병기한다.
> (형제 레포 3개는 `--depth 1` 클론 후 tree → README → 설정 → 대표 소스 순으로만 탐색)

## 0. 현재 레포 요약

PRIMITIVE_WEB은 영문 링크·PDF·붙여넣은 본문을 받아 Claude(Sonnet 5)로 한글 번역·구조화·증류해주는 개인용 리더 웹앱이다. Node.js(ESM) + Express 서버(`src/server.js`)가 백그라운드 잡 모델로 변환을 돌리고, 바닐라 JS 프런트(`public/app.js`)가 폴링으로 결과를 받아 localStorage 보관함에 저장한다. 본문 수집은 `src/lib/fetchArticle.js`(직접 fetch → 트윗 전용 4중 전략 → Jina 리더 프록시 폴백), LLM 호출은 `src/lib/distill.js`가 담당한다. Render 무료 티어에 `render.yaml` Blueprint로 배포되며, 소스는 서버 3개 + 프런트 3개 파일, 약 1,900 LOC(JS) 규모다.

## 1. 비교 대상 개요

| 레포 | 무엇 | 스택 | 규모 |
|---|---|---|---|
| **PRIMITIVE_WEB** (현재) | 영문 링크/PDF → 한글 증류 리더 | Node/Express + 바닐라 JS | ~1.9k LOC |
| **sv-explorer** | 유튜브 자막 → 증류 리더 (`package.json` `yt-distill-reader`) | Node/Express + 바닐라 JS (LLM 호출은 브라우저에서 본인 키로) | ~3.4k LOC |
| **IR-Analysis** | 실적발표 자동 분석 CLI 파이프라인 + 정적 뷰어 | Python 3.11/3.12 + anthropic SDK, 서버 없음 | ~2.2k LOC |
| **Mybots** | 회의 음성 → Whisper 전사 → Claude 회의록 (`meeting-minutes/`) + 무관한 정적 HTML 혼재 | Node/Express + OpenAI/Anthropic | ~1.2k LOC(앱) |

셋 다 같은 사람(1인)이 같은 스타일로 만든 소형 프로젝트라, "업계 모범 사례"가 아니라 **서로 간의 상대 우위**만 뽑는다.

---

## 2. 축별 비교

### ① 프로젝트 구조·모듈화

- **최우수: IR-Analysis** — 분석(`ir_analysis/`) / 렌더(`render/`) / 설정(`config/`) / 산출물(`analyses/`, `docs/`)이 디렉터리로 명확히 분리되고, 특히 **페르소나·문체 규칙을 코드가 아닌 데이터로 외부화**했다(`config/personas/*.yaml`, `config/style_guide.md` — 런타임에 시스템 프롬프트에 주입, `ir_analysis/analyze.py:179-183`).
- **현재 레포**: 서버는 라우팅(`src/server.js`) / 수집(`src/lib/fetchArticle.js`) / LLM(`src/lib/distill.js`)로 관심사 분리가 이미 명확하다. 다만 관점(렌즈) 기본값·프롬프트·문체 규칙이 전부 `src/lib/distill.js` 안에 하드코딩돼 있다.
- **차이의 원인**: IR-Analysis는 "관점을 바꿔가며 여러 번 실행"하는 CLI라 외부화가 필수였고, 현재 레포는 관점을 UI 입력(`public/index.html`의 lens-box)으로 받아 서버는 기본값 하나만 가지면 됐다.
- **판정: 보류.** 프롬프트를 YAML로 빼는 리팩터링은 1인 웹앱에선 파일만 늘린다. 단, 관점 프리셋(현재 `public/index.html:53-56`에 하드코딩된 칩 4개)이 더 늘어나거나 IR-Analysis처럼 레포 간 페르소나를 공유하고 싶어지면 그때 `config/` 분리를 검토할 가치가 있다. (참고: IR-Analysis의 `config/config.yaml` `persona_repos`에 이 레포가 이미 등록돼 있어, 공유 수요가 실재한다.)

### ② 에러 핸들링·로깅

- **최우수: IR-Analysis** — 실패 모드 처리가 가장 성숙하다. `max_tokens`로 잘린 보고서에 ⚠️ 경고를 본문·프런트매터·stderr 3곳에 남겨 "조용한 불완전 저장"을 막고(`ir_analysis/analyze.py:262-268`), `stop_reason`(refusal/pause_turn/max_tokens)을 각각 분기 처리하며(`analyze.py:240-268`), 400 에러에 원인 힌트+폴백 안내를 붙인다(`analyze.py:232-237`). sv-explorer는 폴백 체인의 각 실패를 `errors[]`로 모아 최종 에러 메시지에 합치는 패턴이 좋다(`src/lib/fetchTranscript.js:299-312`).
- **현재 레포**: 잡 모델의 `onProgress` 단계 로그 + `status:"error"` 전달(`src/server.js:115-125`), 한국어 사용자 메시지, 수집 폴백 체인은 sv-explorer와 동급(같은 계열 코드). 전용 로거는 없고 `console.*`은 서버 기동 시 2회뿐 — 진행 상황이 로그 대신 잡 스텝으로 사용자에게 직접 가는 구조라 1인 운영엔 오히려 낫다.
- **차이의 원인**: IR-Analysis는 결과가 파일로 저장돼 나중에 읽히므로 "불완전한 산출물" 탐지가 사활적이었다. 현재 레포도 결과가 localStorage에 영구 보관되므로 같은 리스크가 있다.
- **판정: 부분 채택.** 로거 도입·에러 체계 개편은 부적합(과함). 단 **증류 응답의 `stop_reason` 검사 + 잘렸을 때 결과에 경고 필드를 남기는 것**은 IR-Analysis에서 가져올 가치가 있다 — 현재 `src/lib/distill.js`는 tool_use 파싱 실패만 잡고 max_tokens 절단은 조용히 지나갈 수 있다.

### ③ 테스트·검증

- **최우수: 없음.** 네 레포 모두 테스트 파일 0개, 테스트 프레임워크 미도입, lint/formatter 설정 전무다(sv-explorer: test 스크립트 없음 `package.json:7-10`; IR-Analysis: pytest/ruff 부재; Mybots: `*.test.js` 0개). 유일한 검증 자산은 셋 다 가진 `/api/health` 헬스체크뿐(sv-explorer `src/server.js:80-82`, Mybots `meeting-minutes/src/server.js`, 현재 레포 `src/server.js:88-90`).
- **현재 레포**: 동일하게 0. 다만 개발 세션에서 `node --check` + 로컬 부팅 + `/api/health` curl을 수동으로 반복해온 것이 사실상의 smoke test였다 — 자동화만 안 돼 있다.
- **차이의 원인**: 전부 1인 취미 프로젝트라 테스트 관성이 없었다. 상대 우위가 없으므로 "누구 방식을 채택"이 아니라 공백을 메울지의 문제다.
- **판정: 채택(경량 한정).** 유닛 테스트 스위트는 부적합(UI+외부 API 의존이 커서 비용 대비 효과 낮음). 대신 `npm test`에 **① `node --check` 전 소스, ② 서버 부팅 후 `/api/health` 200 확인** 정도의 smoke test 한 파일(수십 줄)은 붙일 가치가 충분하다 — 지금까지 매 PR마다 손으로 하던 일의 자동화라 비용이 거의 0이다.

### ④ CI·배포

- **최우수: IR-Analysis** — 유일하게 GitHub Actions를 쓴다(`.github/workflows/analyze.yml`). 다만 push/PR 검증 게이트가 아니라 `workflow_dispatch` 분석 실행 잡이다. 배포 쪽 디테일이 좋다: `render.yaml`의 빌드 실패 시 커밋된 산출물로 폴백(`buildCommand ... || echo "using committed docs/"`, `render.yaml:15`), Actions의 concurrency 큐잉·푸시 충돌 3회 재시도(`analyze.yml:56-58,117-123`).
- **현재 레포**: `render.yaml` Blueprint(healthCheckPath, `ANTHROPIC_API_KEY` `sync: false`, NODE_VERSION 22)는 sv-explorer·Mybots와 동급으로 잘 돼 있고 `.env.example`도 상세하다. CI는 없음(진단용 probe.yml을 한 번 만들었다 삭제한 이력만 있음). **공백 하나**: 코드가 실제로 읽는 `ACCESS_KEY`(`src/server.js:68`)와 `READER_PROXY`(`.env.example`)가 `render.yaml` `envVars`에 선언돼 있지 않다 — 새 환경에 Blueprint로 재배포하면 접근 잠금이 조용히 풀린 채 뜬다.
- **차이의 원인**: IR-Analysis는 "브라우저에서 Actions API를 호출해 분석 실행"이 제품 기능이라 워크플로가 필수였다. 현재 레포는 Render 자동 배포만으로 충분했다.
- **판정: 부분 채택.** ⑴ `render.yaml`에 `ACCESS_KEY`·`READER_PROXY`를 `sync: false`로 명시 — 5분짜리 수정으로 배포 재현성 결함을 없앤다: **채택**. ⑵ ③의 smoke test를 push 시 돌리는 초경량 CI 워크플로 1개: **채택**. ⑶ concurrency·재시도 등 Actions 고급 패턴: 실행 잡이 없으므로 **부적합**.

### ⑤ 의존성 관리

- **최우수: sv-explorer** — lockfile 있음(`package-lock.json`) + 직접 의존성 4개로 최소(`package.json:14-19`). Mybots는 **lockfile이 아예 없고**(`meeting-minutes/`에 package-lock 부재) 미사용 의심 의존성(`youtube-transcript`)까지 있어 최하위. IR-Analysis는 의존성 2개로 가장 적지만 lockfile 없이 `>=` 하한만 지정하고 Python 버전도 render(3.11.9)와 Actions(3.12)가 불일치한다.
- **현재 레포**: `package-lock.json` 있음, 직접 의존성 6개(전부 실사용: express/dotenv/@anthropic-ai/sdk/node-html-parser/pdf-lib/pdf-parse), `engines >=20` + render NODE_VERSION 22. 사실상 sv-explorer와 동급이며 결함 없음.
- **차이의 원인**: 없음 — 같은 습관의 산물이고 Mybots만 lockfile 커밋을 빠뜨렸다.
- **판정: 현행 유지(채택할 것 없음).** 캐럿(`^`) 레인지는 lockfile이 있으므로 소형 프로젝트에서 문제가 아니다. 정확 핀 전환은 부적합(갱신 비용만 늘림).

### ⑥ 에이전트 설정 자산

- **최우수: 없음(4개 레포 전부 전무).** CLAUDE.md, `.claude/`(rules/skills/hooks), `.mcp.json` 어느 것도 어떤 레포에도 없다. 유일한 기능적 유사물은 IR-Analysis의 페르소나·프롬프트 외부화(`config/personas/`, `config/style_guide.md`)인데, 이는 **런타임 제품 자산**이지 코딩 에이전트용 온보딩 자산이 아니다.
- **현재 레포**: 동일하게 전무. 그런데 이 레포는 형제들과 달리 **Claude Code 세션으로 계속 개발·운영되고 있다**(이 문서 포함 PR #30~#37 전부). 매 세션이 "Render 무료 티어 제약, 잡 모델, 캐시 버스팅 `?v=` 규칙, 커밋·PR 관례, 프록시 샌드박스에서 외부 접근 불가" 같은 맥락을 처음부터 다시 발견해왔다.
- **차이의 원인**: 습관 부재일 뿐, 필요는 네 레포 중 이 레포가 가장 크다.
- **판정: 채택.** `CLAUDE.md` 한 파일(스택·아키텍처 불변식·검증 절차·배포/캐시 규칙·샌드박스 제약)을 두는 것은 비용이 문서 1개 수준이고, 이후 모든 세션의 온보딩 비용을 줄인다. `.claude/rules`·skills·hooks·`.mcp.json`은 현 규모에서 **부적합**(관리할 자동화가 없음).

---

## 3. 채택 후보 Top 5 (구현 비용 대비 효과 순)

| # | 항목 | 출처(벤치마크 근거) | 비용 | 효과 |
|---|---|---|---|---|
| 1 | **`render.yaml`에 `ACCESS_KEY`·`READER_PROXY` envVars 선언(`sync: false`)** | 자체 발견 + Mybots/sv-explorer의 `sync:false` 관례 (`meeting-minutes/render.yaml`, sv-explorer `render.yaml:11-24`) | 몇 분 | Blueprint 재배포 시 접근 잠금이 조용히 풀리는 결함 제거 |
| 2 | **`CLAUDE.md` 작성** (아키텍처 불변식 + 검증 절차 + 배포·캐시 규칙 + 샌드박스 제약) | 4개 레포 공통 공백 — 이 레포만 에이전트 상주 개발 중 | ~30분 | 매 Claude Code 세션의 재발견 비용 제거, 규칙 위반 실수 방지 |
| 3 | **smoke test 스크립트 + `npm test`** (`node --check` 전 소스 → 부팅 → `/api/health` 200) | ③축 공백 — 매 PR 수동 반복하던 검증의 자동화 | ~1시간 | 배포 전 최소 안전망, 사실상 기존 수동 절차의 성문화 |
| 4 | **push 시 smoke test를 돌리는 초경량 GitHub Actions 1개** | IR-Analysis가 유일하게 Actions 사용(`.github/workflows/analyze.yml`) — 단 목적은 다름 | ~30분 (3 선행) | master 머지 = Render 자동 배포이므로, 배포 직전 마지막 자동 관문 |
| 5 | **증류 응답 `stop_reason` 검사 — 잘린 결과에 명시 경고** | IR-Analysis의 truncation 3중 경고 (`ir_analysis/analyze.py:262-268`) | ~1시간 | 불완전한 증류가 조용히 보관함에 영구 저장되는 것을 방지 |

**보류로 분류한 것들**: 프롬프트·페르소나 YAML 외부화(①, 공유 수요가 커지면), sv-explorer식 인메모리 레이트리밋(②/④, `ACCESS_KEY` 잠금이 이미 있어 중복 방어 — 키 유출 시나리오에만 유효), 전용 로거 도입(②, 잡 스텝 로그로 충분).

**부적합으로 분류한 것들**: 유닛 테스트 스위트(③), 정확 버전 핀(⑤), `.claude/` rules·skills·hooks·`.mcp.json`(⑥), Actions concurrency·재시도 패턴(④) — 전부 1인 소형 웹앱 규모를 넘는 관리 비용을 만든다.
