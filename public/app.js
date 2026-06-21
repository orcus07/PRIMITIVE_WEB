// 영문 링크 → 한글 증류 리더 — 프런트엔드.
// 링크(또는 붙여넣은 본문) → 서버 증류 → 결과 표시 → 보관함(localStorage) 저장·검색.
(function () {
  "use strict";

  const STORAGE_KEY = "reader-archive/v1";
  const $ = (id) => document.getElementById(id);

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

  // NDJSON 스트림을 읽으며 진행 단계를 logStep으로 표시하고 최종 결과를 반환.
  async function postStream(endpoint, body) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.body) { // 스트림 미지원/즉시 에러
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `오류 (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", result = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === "step") logStep(evt.msg);
        else if (evt.type === "error") throw new Error(evt.error);
        else if (evt.type === "result") result = evt.data;
      }
    }
    if (!result) throw new Error("결과를 받지 못했습니다. (연결이 끊겼을 수 있어요)");
    return result;
  }

  async function digestUrl() {
    const url = $("url").value.trim();
    if (!url) return alert("링크를 입력하세요.");
    busy(true);
    try {
      const result = await postStream("/api/digest", { url });
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
      const result = await postStream("/api/digest-text", {
        text,
        title: $("paste-title").value.trim(),
        url: $("paste-url").value.trim(),
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
      const result = await postStream("/api/digest-pdf", { base64, filename: file.name });
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
      div.append(h, p); wrap.appendChild(div);
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

  renderList();
})();
