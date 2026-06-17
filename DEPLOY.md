# 🚀 클라우드 배포 가이드 (Render) — 폰·PC 어디서나 쓰기

노트북을 켜둘 필요 없이, 인터넷에 항상 떠 있는 **내 전용 주소**를 만드는 방법입니다.
처음 한 번만 하면 되고, 클릭 위주라 어렵지 않아요.

준비물: ① GitHub 계정 ② Render 계정(무료) ③ Anthropic API 키 1개

---

## 0단계 — 코드를 master에 합치기 (한 번만)

지금 리더 코드는 `claude/unclear-request-plepdz` 브랜치에 있어요.
[PR #2](https://github.com/orcus07/PRIMITIVE_WEB/pull/2) 를 열어 **Merge**(병합)하면 `master`에 들어갑니다.
(또는 아래 4단계에서 배포 브랜치를 이 브랜치로 골라도 됩니다.)

## 1단계 — Render 가입

1. https://render.com 접속 → **Get Started** → **GitHub로 로그인**
2. 신용카드 필요 없음 (무료 플랜)

## 2단계 — Anthropic API 키 준비

1. https://console.anthropic.com → 로그인
2. **API Keys** → **Create Key** → 생성된 `sk-ant-...` 키를 복사해 둠
   (이 키는 한 번만 보이니 메모장에 잠깐 붙여두세요)

## 3단계 — 저장소 연결

1. Render 대시보드 → **New +** → **Blueprint**
2. `orcus07/PRIMITIVE_WEB` 저장소 선택 → **Connect**
3. Render가 저장소의 `render.yaml` 을 자동으로 읽어 서비스 설정을 보여줌 → **Apply**

> Blueprint가 안 보이면: **New + → Web Service** 로 만들고
> Build Command `npm install`, Start Command `npm start`, Plan `Free` 로 직접 지정해도 됩니다.

## 4단계 — API 키 입력 & 배포

1. 배포 화면에서 **Environment(환경 변수)** 항목에 `ANTHROPIC_API_KEY` 가 보임
2. 거기에 2단계에서 복사한 `sk-ant-...` 키를 붙여넣기
3. (브랜치 선택 칸이 있으면 `master` 또는 `claude/unclear-request-plepdz` 선택)
4. **Create / Deploy** 클릭 → 몇 분 기다리면 빌드 완료

## 5단계 — 완성! 주소 열기

- 배포가 끝나면 `https://english-reader-xxxx.onrender.com` 같은 **주소**가 생깁니다.
- 이 주소를 **PC 브라우저**로 열면 끝.
- **폰**에서도 같은 주소를 열면 동일하게 동작 → 즐겨찾기/홈 화면에 추가해두면 앱처럼 써요.

---

## 알아두면 좋은 점

- **무료 플랜은 한동안 안 쓰면 잠들어요.** 그래서 한참 만에 열면 첫 화면이 30~50초쯤 느릴 수 있어요(서버가 다시 깨어나는 시간). 두 번째부터는 빠릅니다.
- **앱을 수정하면?** 코드를 GitHub에 push할 때마다 Render가 **자동으로 다시 배포**해줘요. (제가 작업 후 push하면 자동 반영)
- **비용**: Render 무료 플랜은 0원. 단, 글을 처리할 때 쓰는 **Claude API 사용료**는 Anthropic 쪽에서 별도로 과금돼요(글 1개에 수십~수백 원 수준). https://console.anthropic.com 에서 사용량·한도를 볼 수 있어요.
- **데이터**: 읽은 글 보관함은 각 브라우저(localStorage)에 저장돼요. 폰과 PC는 서로 별개로 쌓입니다. (여러 기기 동기화가 필요하면 나중에 DB를 붙이면 됩니다.)

## 막히면

- 빌드 실패 시 Render의 **Logs** 탭을 보면 원인이 나옵니다. 그 로그를 저에게 보여주시면 같이 고쳐요.
- 화면은 떴는데 "ANTHROPIC_API_KEY 미설정" 경고가 뜨면 → 4단계 환경변수를 다시 확인하세요.
