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
    setStatus(on ? "증류 중… (번역·구조화는 시간이 좀 걸려요)" : "");
  }

  async function digestUrl() {
    const url = $("url").value.trim();
    if (!url) return alert("링크를 입력하세요.");
    busy(true);
    try {
      const result = await postJson("/api/digest", { url });
      saveAndShow(result);
      $("url").value = "";
    } catch (err) {
      alert(err.message);
    } finally { busy(false); }
  }

  async function digestPaste() {
    const text = $("paste-text").value.trim();
    if (text.length < 100) return alert("본문을 100자 이상 붙여넣어 주세요.");
    busy(true);
    try {
      const result = await postJson("/api/digest-text", {
        text, title: $("paste-title").value.trim(),
      });
      saveAndShow(result);
      $("paste-text").value = "";
      $("paste-title").value = "";
      $("paste-box").classList.add("hidden");
    } catch (err) {
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
    $("r-oneliner").textContent = r.oneLiner || "";
    $("r-topic").textContent = r.topic || "";
    fillList("r-insight", r.marketerInsight);
    renderSections(r.sections);
    renderTerms(r.keyTerms);

    const link = $("r-link");
    if (r.url) { link.href = r.url; link.classList.remove("hidden"); }
    else link.classList.add("hidden");

    $("delete-btn").classList.remove("hidden");
    markActive();
  }

  function viaLabel(v) {
    return { direct: "직접 수집", proxy: "프록시 우회", paste: "붙여넣기" }[v] || "";
  }
  function fillList(id, items) {
    const ul = $(id); ul.innerHTML = "";
    (items || []).forEach((t) => {
      const li = document.createElement("li"); li.textContent = t; ul.appendChild(li);
    });
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
      ...(r.marketerInsight || []), ...(r.sections || []).map((s) => s.heading + " " + s.content)]
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
  $("delete-btn").addEventListener("click", removeCurrent);
  $("search").addEventListener("input", renderList);

  renderList();
})();
