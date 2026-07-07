// 영문 링크 → 한글 증류 리더 — 프런트엔드.
// 링크(또는 붙여넣은 본문) → 서버 증류 → 결과 표시 → 보관함(localStorage) 저장·검색.
(function () {
  "use strict";

  const STORAGE_KEY = "reader-archive/v1";
  const LENS_KEY = "reader-perspective/v1";
  const $ = (id) => document.getElementById(id);

  /* ---------- 접근 잠금(암호) ---------- */
  // 서버에 ACCESS_KEY가 설정돼 있으면 API가 401을 준다.
  // 그때 암호를 물어 저장하고 재시도 — 한 번 넣으면 이 브라우저에선 계속 기억.
  const ACCESS_STORE = "reader-access-key/v1";
  function getAccessKey() { try { return localStorage.getItem(ACCESS_STORE) || ""; } catch { return ""; } }
  function setAccessKey(k) { try { localStorage.setItem(ACCESS_STORE, k); } catch {} }
  async function apiFetch(url, options = {}, retried = false) {
    const headers = Object.assign({}, options.headers);
    const key = getAccessKey();
    if (key) headers["x-access-key"] = key;
    const res = await fetch(url, Object.assign({}, options, { headers }));
    if (res.status === 401 && !retried) {
      const entered = prompt("🔒 이 사이트는 잠겨 있어요. 접근 암호를 입력하세요:");
      if (entered === null) return res; // 취소 → 401 그대로 반환
      setAccessKey(entered.trim());
      return apiFetch(url, options, true);
    }
    return res;
  }

  /* ---------- 독자 관점(렌즈) ---------- */
  // 비우면 서버 기본값(반도체 마케터)으로 분석된다. 입력값은 localStorage에 저장.
  function getPerspective() {
    return ($("lens-input").value || "").trim();
  }
  function loadPerspective() {
    try { return localStorage.getItem(LENS_KEY) || ""; } catch { return ""; }
  }
  function savePerspective() {
    try { localStorage.setItem(LENS_KEY, getPerspective()); } catch {}
  }
  // 결과 헤딩에 쓰는 짧은 관점 라벨.
  function angleTitleOf(p) {
    // 자동 프로필처럼 긴 문장이면 앞부분만 짧게.
    const t = (p || "").trim();
    if (!t) return "반도체 마케터";
    return t.length > 24 ? t.slice(0, 24) + "…" : t;
  }

  /* ---------- 내 프로필(자동 정의) ---------- */
  // 읽은 글들로 "나"를 추론해 관점(렌즈)에 채운다. 자동 갱신 가능.
  const AUTO_KEY = "reader-profile-auto/v1";   // 자동 갱신 켜짐 여부
  const LAST_AUTO_KEY = "reader-profile-last/v1"; // 마지막 자동 생성값(수동 편집 보호용)
  function archiveSummaries() {
    return records.map((r) => ({
      title: r.koreanTitle || r.originalTitle || "",
      oneLiner: r.oneLiner || "",
      topic: r.topic || "",
    }));
  }
  async function buildProfile({ silent = false } = {}) {
    const items = archiveSummaries();
    const status = $("profile-status");
    if (items.length < 2) {
      if (!silent) status.textContent = "읽은 글이 2개 이상일 때 나를 정의할 수 있어요.";
      return;
    }
    status.textContent = "🧬 내 글들로 프로필 분석 중…";
    try {
      const res = await apiFetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.profile) throw new Error(data.error || `오류 (${res.status})`);
      $("lens-input").value = data.profile;
      savePerspective();
      try { localStorage.setItem(LAST_AUTO_KEY, data.profile); } catch {}
      status.textContent = `✅ 프로필이 갱신돼 관점에 반영됐어요 (읽은 글 ${items.length}개 기반).`;
    } catch (err) {
      status.textContent = "❌ " + err.message;
    }
  }
  // 새 글이 추가될 때, 자동 갱신이 켜져 있고 사용자가 손수 바꾼 관점이 아니면 다시 만든다.
  function maybeAutoProfile() {
    let auto = false;
    try { auto = localStorage.getItem(AUTO_KEY) === "1"; } catch {}
    if (!auto || records.length < 2) return;
    let last = "";
    try { last = localStorage.getItem(LAST_AUTO_KEY) || ""; } catch {}
    const cur = ($("lens-input").value || "").trim();
    // 비어 있거나 마지막 자동값 그대로일 때만 갱신(수동 편집은 보호)
    if (cur && cur !== last.trim()) return;
    buildProfile({ silent: true });
  }

  let records = load();
  let currentId = null;

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); return; } catch {}
    // 1차: 영어 원문 전문 제거(완역이 있으면 그 안에 영어가 들어 있어 중복).
    try {
      records = records.map((r) =>
        (r.fullTranslation && r.fullTranslation.length)
          ? (() => { const c = { ...r }; delete c.sourceText; return c; })()
          : r);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      return;
    } catch {}
    // 2차: 원문·완역 본문 모두 제거.
    try {
      records = records.map((r) => { const c = { ...r }; delete c.sourceText; delete c.fullTranslation; return c; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      alert("보관 용량이 가득 차 원문·완역 본문은 저장하지 못했어요. (지금 화면에서는 볼 수 있어요)");
    } catch {
      alert("브라우저 보관 용량이 가득 찼어요. 보관함에서 오래된 글을 삭제해 주세요.");
    }
  }

  /* ---------- 키 안내 ---------- */
  fetch("/api/health").then((r) => r.json()).then((h) => {
    if (!h.anthropic) {
      const w = $("key-warning");
      w.textContent = "⚠️ 서버에 ANTHROPIC_API_KEY 가 설정되지 않았습니다. .env 파일을 확인해주세요.";
      w.classList.remove("hidden");
    }
  }).catch(() => {});

  /* ---------- 실행 ---------- */
  // 진행 상황은 까만 진행 로그로 충분 — 별도 회색 상태 텍스트는 두지 않는다.
  function setStatus() {}

  function busy(on) {
    $("run-btn").disabled = on;
    $("paste-run").disabled = on;
    $("pdf-run").disabled = on;
    if (on) startProgress();
    else setStatus("");
  }

  /* ---------- 진행 로그 ---------- */
  let progStart = 0;
  function startProgress() {
    progStart = Date.now();
    const log = $("progress-log");
    log.innerHTML = "";
    log.classList.remove("hidden");
    setStatus("시작…");
  }
  function logStep(msg) {
    const log = $("progress-log");
    log.classList.remove("hidden");
    const t = ((Date.now() - progStart) / 1000).toFixed(1);
    const li = document.createElement("li");
    li.textContent = `+${t}s  ${msg}`;
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
    setStatus(msg);
  }

  // ── 작업(job) 폴링 ──────────────────────────────────────────
  // 변환은 서버에서 연결과 무관하게 돌아간다. 브라우저는 jobId를 폴링해
  // 진행 상황을 표시하고 결과를 받는다. 백그라운드/새로고침에도 살아남는다.
  const PENDING_KEY = "reader-pending-job/v1";
  function savePending(id) { try { localStorage.setItem(PENDING_KEY, id); } catch {} }
  function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch {} }
  function loadPending() { try { return localStorage.getItem(PENDING_KEY) || ""; } catch { return ""; } }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 서버가 준 경과시간(ms) 기준으로 진행 로그 한 줄 추가.
  function logStepMs(ms, msg) {
    const log = $("progress-log");
    log.classList.remove("hidden");
    const li = document.createElement("li");
    li.textContent = `+${(ms / 1000).toFixed(1)}s  ${msg}`;
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
    setStatus(msg);
  }

  function resultIsOk(r) {
    return !!(r && (r.koreanTitle || r.originalTitle || (r.sections && r.sections.length)));
  }

  // 작업 제출 → jobId.
  async function submitJob(endpoint, body) {
    const res = await apiFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.jobId) throw new Error(data.error || `오류 (${res.status})`);
    return data.jobId;
  }

  // jobId 폴링. 백그라운드 복귀 시 일시적 네트워크 오류는 재시도로 흡수.
  // isOk(result): 결과 유효성 검사(기본은 증류 결과 기준). 번역 등 다른 작업은 따로 전달.
  async function pollJob(jobId, isOk) {
    const valid = isOk || resultIsOk;
    let shown = 0, netErrors = 0;
    for (;;) {
      let res, data;
      try {
        res = await apiFetch(`/api/job/${jobId}`);
        data = await res.json().catch(() => ({}));
      } catch {
        if (++netErrors > 40) throw new Error("연결이 계속 끊겨요. 잠시 후 다시 시도해주세요.");
        await sleep(2000);
        continue;
      }
      if (res.status === 404) throw new Error(data.error || "작업을 찾을 수 없어요.");
      netErrors = 0;
      const steps = data.steps || [];
      for (; shown < steps.length; shown++) logStepMs(steps[shown].ms, steps[shown].msg);
      if (data.status === "done") {
        if (!valid(data.result)) throw new Error("결과가 비어 있어요. 새로고침 후 다시 시도해주세요.");
        return data.result;
      }
      if (data.status === "error") throw new Error(data.error || "처리 중 오류가 발생했습니다.");
      await sleep(1500);
    }
  }

  // 제출 + pending 저장 + 폴링. 완료/실패 시 pending 정리(이어보기 중단).
  async function runJob(endpoint, body) {
    const jobId = await submitJob(endpoint, body);
    savePending(jobId);
    try {
      return await pollJob(jobId);
    } finally {
      clearPending();
    }
  }

  // 같은 링크 재증류 방지 — 다시 돌리면 같은 비용이 다시 청구되므로 먼저 확인.
  function normUrl(u) {
    return (u || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
  async function digestUrl() {
    const url = $("url").value.trim();
    if (!url) return alert("링크를 입력하세요.");
    const dup = records.find((r) => r.url && normUrl(r.url) === normUrl(url));
    if (dup) {
      const name = dup.koreanTitle || dup.originalTitle || "(제목 없음)";
      const again = confirm(
        `이미 보관함에 있는 글이에요:\n“${name}”\n\n` +
        `다시 증류하면 같은 비용이 다시 청구됩니다.\n` +
        `[확인] 그래도 다시 증류  ·  [취소] 보관된 결과 열기`
      );
      if (!again) { show(dup); $("url").value = ""; return; }
    }
    busy(true);
    try {
      const result = await runJob("/api/digest", { url, perspective: getPerspective() });
      logStep("🎉 완료");
      saveAndShow(result);
      $("url").value = "";
    } catch (err) {
      logStep("❌ " + err.message);
      alert(err.message);
    } finally { busy(false); }
  }

  async function digestPaste() {
    const text = $("paste-text").value.trim();
    if (text.length < 100) return alert("본문을 100자 이상 붙여넣어 주세요.");
    busy(true);
    try {
      const result = await runJob("/api/digest-text", {
        text,
        title: $("paste-title").value.trim(),
        url: $("paste-url").value.trim(),
        perspective: getPerspective(),
      });
      logStep("🎉 완료");
      saveAndShow(result);
      $("paste-text").value = "";
      $("paste-title").value = "";
      $("paste-url").value = "";
      $("paste-box").classList.add("hidden");
    } catch (err) {
      logStep("❌ " + err.message);
      alert(err.message);
    } finally { busy(false); }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = String(reader.result); // data:application/pdf;base64,XXXX
        const comma = res.indexOf(",");
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function digestPdf() {
    const file = $("pdf-file").files && $("pdf-file").files[0];
    if (!file) return alert("PDF 파일을 선택하세요.");
    if (file.size > 22 * 1024 * 1024) return alert("PDF 용량이 너무 큽니다. ~22MB 이하로 올려주세요. (쪽수가 많아도 용량만 작으면 OK)");
    busy(true);
    try {
      logStep(`PDF 읽는 중: ${file.name} (${(file.size / 1048576).toFixed(1)}MB)`);
      const base64 = await fileToBase64(file);
      const result = await runJob("/api/digest-pdf", { base64, filename: file.name, perspective: getPerspective() });
      logStep("🎉 완료");
      saveAndShow(result);
      $("pdf-file").value = "";
      $("pdf-box").classList.add("hidden");
    } catch (err) {
      logStep("❌ " + err.message);
      alert(err.message);
    } finally { busy(false); }
  }

  async function postJson(endpoint, body) {
    const res = await apiFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `오류 (${res.status})`);
    return data;
  }

  /* ---------- 저장 & 표시 ---------- */
  function saveAndShow(result) {
    const record = Object.assign(
      { id: "a_" + Date.now().toString(36), createdAt: Date.now() }, result
    );
    records.push(record);
    persist();
    show(record);
    renderList();
    maybeAutoProfile(); // 자동 갱신 켜져 있으면 새 글까지 반영해 프로필 갱신
  }

  function show(r) {
    currentId = r.id;
    $("result").classList.remove("hidden");
    $("r-title").textContent = r.koreanTitle || r.originalTitle || "(제목 없음)";
    $("r-original").textContent = r.originalTitle ? `원제: ${r.originalTitle}` : "";
    $("r-date").textContent = r.publishedDate ? `작성일: ${r.publishedDate}` : "";
    $("r-oneliner").textContent = r.oneLiner || "";
    $("r-topic").textContent = r.topic || "";
    renderInsight(r);
    renderQuotes(r.keyQuotes);
    renderImages(r.images);
    renderSections(r.sections);
    renderTerms(r.keyTerms);
    renderFullTranslation(r);
    renderSourceText(r);

    const link = $("r-link");
    if (r.url) { link.href = r.url; link.classList.remove("hidden"); }
    else link.classList.add("hidden");

    $("delete-btn").classList.remove("hidden");
    markActive();
  }

  function fillList(id, items) {
    const ul = $(id); ul.innerHTML = "";
    (items || []).forEach((t) => {
      const li = document.createElement("li"); li.textContent = t; ul.appendChild(li);
    });
  }
  // 핵심 시사점 + 반도체 마케터 관점(연관도 정직 표시). 구버전 기록(marketerInsight) 호환.
  function renderInsight(r) {
    // 핵심 시사점
    fillList("r-takeaways", r.keyTakeaways || []);

    // 관점 헤딩(이 글을 분석한 관점). 구버전 기록은 기본값으로.
    $("r-angle-title").textContent = angleTitleOf(r.perspective);

    const angle = r.marketerAngle;
    const relEl = $("r-relevance");
    const noneEl = $("r-angle-none");

    if (angle && typeof angle === "object") {
      const labels = { high: "연관도 높음", medium: "연관도 보통", low: "연관도 낮음", none: "직접 연관 없음" };
      relEl.textContent = labels[angle.relevance] || "";
      relEl.className = "relevance rel-" + (angle.relevance || "none");
      const notes = angle.notes || [];
      fillList("r-angle", notes);
      noneEl.classList.toggle("hidden", notes.length > 0);
    } else {
      // 구버전: marketerInsight 배열을 그대로 표시
      relEl.textContent = "";
      relEl.className = "relevance";
      fillList("r-angle", r.marketerInsight || []);
      noneEl.classList.add("hidden");
    }
  }

  // 본문 주요 이미지·도표 — 원문에서 추출한 URL을 그대로 표시(저장은 URL만).
  // 핫링크가 차단되거나 깨진 이미지는 조용히 치운다.
  function renderImages(images) {
    const wrap = $("r-images");
    wrap.innerHTML = "";
    const list = (images || []).filter((im) => im && im.src);
    $("r-images-wrap").classList.toggle("hidden", list.length === 0);
    list.forEach((im) => {
      const fig = document.createElement("figure");
      fig.className = "r-img";
      const a = document.createElement("a");
      a.href = im.src; a.target = "_blank"; a.rel = "noopener";
      const img = document.createElement("img");
      img.src = im.src;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.alt = im.caption || "";
      img.addEventListener("error", () => {
        fig.remove();
        if (!$("r-images").children.length) $("r-images-wrap").classList.add("hidden");
      });
      a.appendChild(img);
      fig.appendChild(a);
      if ((im.caption || "").trim()) {
        const cap = document.createElement("figcaption");
        cap.textContent = im.caption.trim();
        fig.appendChild(cap);
      }
      wrap.appendChild(fig);
    });
  }

  function renderSections(sections) {
    const wrap = $("r-sections"); wrap.innerHTML = "";
    (sections || []).forEach((s) => {
      const div = document.createElement("div"); div.className = "section";
      const h = document.createElement("h4"); h.textContent = s.heading || "";
      const p = document.createElement("p"); p.textContent = s.content || "";
      div.append(h, p);
      // 원문(영문) 대조 — GitHub식 펼치기. 원문이 있을 때만 표시.
      const orig = (s.original || "").trim();
      if (orig) {
        const det = document.createElement("details"); det.className = "orig";
        const sum = document.createElement("summary"); sum.textContent = "원문 보기";
        const op = document.createElement("p"); op.className = "orig-text"; op.textContent = orig;
        det.append(sum, op); div.appendChild(det);
      }
      wrap.appendChild(div);
    });
  }
  // 주요 인용 — 원문(영문) 하이라이트 + 한글 번역 + 화자. 구버전 기록엔 없음.
  function renderQuotes(quotes) {
    const wrap = $("r-quotes"); wrap.innerHTML = "";
    const list = (quotes || []).filter((q) => q && (q.quote || "").trim());
    $("r-quotes-wrap").classList.toggle("hidden", list.length === 0);
    list.forEach((q) => {
      const fig = document.createElement("figure"); fig.className = "quote";
      const orig = document.createElement("p"); orig.className = "q-orig";
      orig.textContent = `“${(q.quote || "").trim()}”`;
      fig.appendChild(orig);
      if ((q.translation || "").trim()) {
        const tr = document.createElement("p"); tr.className = "q-tr";
        tr.textContent = q.translation.trim();
        fig.appendChild(tr);
      }
      if ((q.speaker || "").trim()) {
        const who = document.createElement("figcaption"); who.className = "q-who";
        who.textContent = `— ${q.speaker.trim()}`;
        fig.appendChild(who);
      }
      wrap.appendChild(fig);
    });
  }

  function renderTerms(terms) {
    const dl = $("r-terms"); dl.innerHTML = "";
    const has = terms && terms.length;
    $("r-terms-wrap").classList.toggle("hidden", !has);
    (terms || []).forEach((t) => {
      const dt = document.createElement("dt"); dt.textContent = t.term;
      const dd = document.createElement("dd"); dd.textContent = t.note;
      dl.append(dt, dd);
    });
  }
  // 원문 전문(서버 추출, 영어). 완역이 있으면 그 안에 영어가 들어가므로 숨긴다.
  function renderSourceText(r) {
    const t = (r.sourceText || "").trim();
    const hasFull = !!(r.fullTranslation && r.fullTranslation.length);
    $("r-source-wrap").classList.toggle("hidden", !t || hasFull);
    $("r-source-text").textContent = t;
    // 완역 버튼: 원문이 있고 아직 완역 안 했을 때만
    $("r-translate-actions").classList.toggle("hidden", !t || hasFull);
  }

  // 전문 한글 완역(문단별 영↔한). 영어 토글로 대조 읽기.
  let enVisible = false;
  function renderFullTranslation(r) {
    const segs = r.fullTranslation;
    const wrap = $("r-fulltrans-wrap");
    if (!segs || !segs.length) { wrap.classList.add("hidden"); return; }
    wrap.classList.remove("hidden");
    const box = $("r-fulltrans"); box.innerHTML = "";
    segs.forEach((s) => {
      const div = document.createElement("div"); div.className = "seg";
      const ko = document.createElement("p"); ko.className = "seg-ko"; ko.textContent = s.ko || "";
      const en = document.createElement("p"); en.className = "seg-en"; en.textContent = s.en || "";
      div.append(ko, en); box.appendChild(div);
    });
    box.classList.toggle("show-en", enVisible);
    $("toggle-en").textContent = enVisible ? "🇰🇷 한글만 보기" : "🇬🇧 영어 원문 함께 보기";
  }

  // 완역 예상 비용(거친 추정). Sonnet 5 정가: 입력 $3 / 출력 $15 per 1M.
  function estimateTranslateUsd(chars) {
    const inTok = chars / 4;
    const outTok = (chars / 4) * 1.15; // 한글 번역 출력
    return (inTok * 3 + outTok * 15) / 1e6;
  }

  // 버튼: 원문 전체를 한글로 완역(백그라운드 작업). pending 저장 안 함(증류 이어보기와 구분).
  async function makeFullTranslation() {
    const r = records.find((x) => x.id === currentId);
    if (!r) return;
    const src = (r.sourceText || "").trim();
    if (!src) { alert("원문 텍스트가 없어요(스캔본 PDF 등은 완역 불가)."); return; }
    const est = estimateTranslateUsd(src.length);
    if (!confirm(`원문 ${src.length.toLocaleString()}자를 한글로 완역할까요?\n예상 비용 약 $${est.toFixed(2)} · 분량에 따라 시간이 걸려요(백그라운드 진행).`)) return;
    busy(true);
    $("translate-btn").disabled = true;
    try {
      const jobId = await submitJob("/api/translate", { text: src, perspective: getPerspective() });
      const result = await pollJob(jobId, (d) => d && Array.isArray(d.segments) && d.segments.length);
      r.fullTranslation = result.segments;
      persist();
      logStep("🎉 전문 번역 완료");
      show(r);
    } catch (err) {
      logStep("❌ " + err.message);
      alert(err.message);
    } finally {
      busy(false);
      $("translate-btn").disabled = false;
    }
  }

  /* ---------- 백업(내보내기/가져오기) ---------- */
  // 보관함은 이 브라우저의 localStorage에만 있다. 기기 변경·데이터 삭제·
  // 사파리의 미사용 사이트 정리(7일)로 사라질 수 있으므로 파일 백업을 제공한다.
  const LAST_BACKUP_KEY = "reader-last-backup/v1";
  function exportBackup() {
    const data = {
      app: "reader-archive", version: 1,
      exportedAt: new Date().toISOString(),
      perspective: loadPerspective(),
      records,
    };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `읽은글-백업-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    try { localStorage.setItem(LAST_BACKUP_KEY, String(Date.now())); } catch {}
    renderBackupNudge();
  }
  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const incoming = Array.isArray(data) ? data : data.records;
        if (!Array.isArray(incoming)) throw new Error("백업 파일 형식이 아니에요.");
        const have = new Set(records.map((r) => r.id));
        let added = 0;
        incoming.forEach((r) => {
          if (r && r.id && !have.has(r.id)) { records.push(r); have.add(r.id); added++; }
        });
        persist();
        renderList();
        // 백업의 관점은 현재 값이 비어 있을 때만 복원(수동 설정 보호)
        if (data.perspective && !getPerspective()) {
          $("lens-input").value = data.perspective;
          savePerspective();
        }
        alert(`백업에서 ${added}개 글을 가져왔어요.` + (incoming.length - added ? ` (이미 있는 ${incoming.length - added}개는 건너뜀)` : ""));
      } catch (e) {
        alert("백업 파일을 읽지 못했어요: " + e.message);
      }
    };
    reader.readAsText(file);
  }
  // 글이 5개 이상 쌓였는데 백업이 7일 넘게 없으면 안내를 띄운다.
  function renderBackupNudge() {
    const el = $("backup-nudge");
    if (!el) return;
    let last = 0;
    try { last = Number(localStorage.getItem(LAST_BACKUP_KEY) || 0); } catch {}
    const stale = Date.now() - last > 7 * 24 * 3600 * 1000;
    el.classList.toggle("hidden", !(records.length >= 5 && stale));
  }

  /* ---------- 보관함 ---------- */
  function renderList() {
    const q = $("search").value.trim().toLowerCase();
    const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt);
    const filtered = q ? sorted.filter((r) => searchText(r).includes(q)) : sorted;

    const list = $("list"); list.innerHTML = "";
    filtered.forEach((r) => {
      const li = document.createElement("li");
      li.className = "list-item" + (r.id === currentId ? " active" : "");
      li.dataset.id = r.id;
      const title = document.createElement("div");
      title.className = "it-title";
      title.textContent = r.koreanTitle || r.originalTitle || "(제목 없음)";
      const meta = document.createElement("div");
      meta.className = "it-meta";
      meta.textContent = new Date(r.createdAt).toLocaleDateString();
      li.append(title, meta);
      li.addEventListener("click", () => show(r));
      list.appendChild(li);
    });

    $("empty-list").classList.toggle("hidden", filtered.length > 0);
    $("empty-list").textContent =
      records.length === 0 ? "아직 읽은 글이 없습니다." : "검색 결과가 없습니다.";
    $("list-count").textContent = records.length;
    renderBackupNudge();
  }

  function searchText(r) {
    return [r.koreanTitle, r.originalTitle, r.oneLiner, r.topic,
      ...(r.keyTakeaways || []), ...(r.marketerInsight || []),
      ...((r.marketerAngle && r.marketerAngle.notes) || []),
      ...(r.sections || []).map((s) => s.heading + " " + s.content)]
      .filter(Boolean).join(" ").toLowerCase();
  }
  function markActive() {
    [...$("list").children].forEach((li) =>
      li.classList.toggle("active", li.dataset.id === currentId));
  }
  function removeCurrent() {
    if (!currentId) return;
    if (!confirm("이 글을 보관함에서 삭제할까요?")) return;
    records = records.filter((r) => r.id !== currentId);
    persist(); currentId = null;
    $("result").classList.add("hidden");
    renderList();
  }

  /* ---------- 이벤트 ---------- */
  $("run-btn").addEventListener("click", digestUrl);
  $("url").addEventListener("keydown", (e) => { if (e.key === "Enter") digestUrl(); });
  $("paste-run").addEventListener("click", digestPaste);
  $("toggle-paste").addEventListener("click", () =>
    $("paste-box").classList.toggle("hidden"));
  $("pdf-run").addEventListener("click", digestPdf);
  $("toggle-pdf").addEventListener("click", () =>
    $("pdf-box").classList.toggle("hidden"));
  $("delete-btn").addEventListener("click", removeCurrent);
  $("search").addEventListener("input", renderList);

  // 백업 내보내기/가져오기
  $("backup-export").addEventListener("click", exportBackup);
  $("backup-import").addEventListener("click", () => $("backup-file").click());
  $("backup-file").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importBackup(f);
    e.target.value = "";
  });

  // 전문 완역 버튼 + 영어 원문 토글
  $("translate-btn").addEventListener("click", makeFullTranslation);
  $("toggle-en").addEventListener("click", () => {
    enVisible = !enVisible;
    $("r-fulltrans").classList.toggle("show-en", enVisible);
    $("toggle-en").textContent = enVisible ? "🇰🇷 한글만 보기" : "🇬🇧 영어 원문 함께 보기";
  });

  // 읽은 글 목록 접기/펴기 (모바일에선 기본 접힘 — 입력·결과가 바로 보이도록)
  const LIST_KEY = "reader-list-collapsed/v1";
  function applyListCollapsed(collapsed) {
    $("list-wrap").classList.toggle("hidden", collapsed);
    $("list-toggle").setAttribute("aria-expanded", String(!collapsed));
    $("list-toggle").classList.toggle("collapsed", collapsed);
  }
  let listCollapsed;
  try { listCollapsed = localStorage.getItem(LIST_KEY); } catch {}
  // 저장값 없으면: 모바일은 접힘, 데스크톱은 펼침
  if (listCollapsed === null || listCollapsed === undefined) {
    listCollapsed = window.innerWidth <= 760 ? "1" : "0";
  }
  applyListCollapsed(listCollapsed === "1");
  $("list-toggle").addEventListener("click", () => {
    const nowCollapsed = !$("list-wrap").classList.contains("hidden");
    applyListCollapsed(nowCollapsed);
    try { localStorage.setItem(LIST_KEY, nowCollapsed ? "1" : "0"); } catch {}
  });

  // 관점 설정: 토글 열기/닫기, 저장, 프리셋 칩
  $("toggle-lens").addEventListener("click", () =>
    $("lens-box").classList.toggle("hidden"));
  $("lens-input").value = loadPerspective();
  $("lens-input").addEventListener("change", savePerspective);
  document.querySelectorAll(".lens-presets .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $("lens-input").value = chip.dataset.lens || "";
      savePerspective();
    });
  });

  // 내 프로필(자동 정의): 수동 생성 버튼 + 자동 갱신 토글
  $("profile-build").addEventListener("click", () => buildProfile());
  try { $("profile-auto").checked = localStorage.getItem(AUTO_KEY) === "1"; } catch {}
  $("profile-auto").addEventListener("change", (e) => {
    try { localStorage.setItem(AUTO_KEY, e.target.checked ? "1" : "0"); } catch {}
    if (e.target.checked) maybeAutoProfile(); // 켜는 즉시 한 번 반영
  });

  renderList();

  // 페이지 진입 시, 백그라운드/새로고침으로 끊겼던 진행 중 작업이 있으면 이어받는다.
  function resumePendingJob() {
    const jobId = loadPending();
    if (!jobId) return;
    busy(true); // 로그 초기화 + 버튼 비활성화
    setStatus("이전 작업 이어보는 중…");
    logStep("⏳ 진행 중이던 작업을 이어받는 중…");
    pollJob(jobId)
      .then((result) => { logStep("🎉 완료"); saveAndShow(result); })
      .catch((err) => { logStep("❌ " + err.message); })
      .finally(() => { clearPending(); busy(false); });
  }
  resumePendingJob();
})();
