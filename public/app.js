// 영문 링크 → 한글 증류 리더 — 프런트엔드.
// 링크(또는 붙여넣은 본문) → 서버 증류 → 결과 표시 → 보관함(localStorage) 저장·검색.
(function () {
  "use strict";

  const STORAGE_KEY = "reader-archive/v1";
  const LENS_KEY = "reader-perspective/v1";
  const $ = (id) => document.getElementById(id);

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
    return (p || "").trim() || "반도체 마케터";
  }

  let records = load();
  let currentId = null;

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }
  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
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
  function setStatus(msg) { $("status").textContent = msg; }

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
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.jobId) throw new Error(data.error || `오류 (${res.status})`);
    return data.jobId;
  }

  // jobId 폴링. 백그라운드 복귀 시 일시적 네트워크 오류는 재시도로 흡수.
  async function pollJob(jobId) {
    let shown = 0, netErrors = 0;
    for (;;) {
      let res, data;
      try {
        res = await fetch(`/api/job/${jobId}`);
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
        if (!resultIsOk(data.result)) throw new Error("결과가 비어 있어요. 새로고침 후 다시 시도해주세요.");
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

  async function digestUrl() {
    const url = $("url").value.trim();
    if (!url) return alert("링크를 입력하세요.");
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
    if (file.size > 22 * 1024 * 1024) return alert("PDF가 너무 큽니다. ~20MB 이하로 올려주세요.");
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
    const res = await fetch(endpoint, {
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
  }

  function show(r) {
    currentId = r.id;
    $("result").classList.remove("hidden");
    $("r-source").textContent = viaLabel(r.via);
    $("r-title").textContent = r.koreanTitle || r.originalTitle || "(제목 없음)";
    $("r-original").textContent = r.originalTitle ? `원제: ${r.originalTitle}` : "";
    $("r-date").textContent = r.publishedDate ? `작성일: ${r.publishedDate}` : "";
    $("r-oneliner").textContent = r.oneLiner || "";
    $("r-topic").textContent = r.topic || "";
    renderInsight(r);
    renderSections(r.sections);
    renderTerms(r.keyTerms);

    const link = $("r-link");
    if (r.url) { link.href = r.url; link.classList.remove("hidden"); }
    else link.classList.add("hidden");

    $("delete-btn").classList.remove("hidden");
    markActive();
  }

  function viaLabel(v) {
    return { direct: "직접 수집", proxy: "프록시 우회", tweet: "트윗", pdf: "PDF", paste: "붙여넣기" }[v] || "";
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
