// 회의록 정리 시스템 — 프런트엔드.
// 입력(녹음/유튜브/PDF) → 서버 처리 → 결과 표시 → 보관함(localStorage) 저장·검색.
(function () {
  "use strict";

  const STORAGE_KEY = "meeting-archive/v1";
  const $ = (id) => document.getElementById(id);

  let records = load();
  let activeTab = "media";
  let currentId = null;

  /* ---------- 저장소 ---------- */
  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }
  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  /* ---------- 탭 ---------- */
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach((t) =>
        t.classList.toggle("active", t === btn)
      );
      document.querySelectorAll(".panel").forEach((p) =>
        p.classList.toggle("hidden", p.dataset.panel !== activeTab)
      );
    });
  });

  /* ---------- 키 설정 안내 ---------- */
  fetch("/api/health")
    .then((r) => r.json())
    .then((h) => {
      const missing = [];
      if (!h.anthropic) missing.push("ANTHROPIC_API_KEY");
      if (!h.openai) missing.push("OPENAI_API_KEY");
      if (missing.length) {
        const w = $("key-warning");
        w.textContent = `⚠️ 서버에 ${missing.join(", ")} 가 설정되지 않았습니다. .env 파일을 확인해주세요.`;
        w.classList.remove("hidden");
      }
    })
    .catch(() => {});

  /* ---------- 실행 ---------- */
  function setStatus(msg) {
    $("status").textContent = msg;
  }

  async function run() {
    const btn = $("run-btn");
    btn.disabled = true;
    setStatus("처리 중… (받아쓰기·요약은 시간이 걸릴 수 있어요)");
    try {
      let result;
      if (activeTab === "media") {
        result = await postFile("/api/process/media", $("media-file"));
      } else if (activeTab === "document") {
        result = await postFile("/api/process/document", $("document-file"));
      } else {
        const url = $("youtube-url").value.trim();
        if (!url) throw new Error("유튜브 링크를 입력하세요.");
        result = await postJson("/api/process/youtube", { url });
      }
      saveAndShow(result);
      setStatus("완료 ✓");
    } catch (err) {
      setStatus("");
      alert(err.message || "처리 중 오류가 발생했습니다.");
    } finally {
      btn.disabled = false;
    }
  }

  async function postFile(endpoint, input) {
    const file = input.files && input.files[0];
    if (!file) throw new Error("파일을 선택하세요.");
    const fd = new FormData();
    fd.append("file", file);
    return request(endpoint, { method: "POST", body: fd });
  }
  function postJson(endpoint, body) {
    return request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  async function request(endpoint, opts) {
    const res = await fetch(endpoint, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `오류 (${res.status})`);
    return data;
  }

  /* ---------- 결과 저장 & 표시 ---------- */
  function saveAndShow(result) {
    const record = Object.assign(
      { id: "r_" + Date.now().toString(36), createdAt: Date.now() },
      result
    );
    records.push(record);
    persist();
    currentId = record.id;
    show(record);
    renderList();
  }

  function show(r) {
    currentId = r.id;
    $("result").classList.remove("hidden");
    $("r-title").textContent = r.title || "(제목 없음)";
    $("r-source").textContent = sourceLabel(r.source);
    $("r-summary").textContent = r.summary || "";
    fillList("r-keypoints", r.keyPoints);
    fillList("r-decisions", r.decisions);
    fillList("r-actions", r.actionItems);
    toggleWrap("r-decisions-wrap", r.decisions);
    toggleWrap("r-actions-wrap", r.actionItems);

    const hasTranscript = Boolean(r.transcript);
    $("r-transcript-wrap").classList.toggle("hidden", !hasTranscript);
    if (hasTranscript) $("r-transcript").textContent = r.transcript;

    $("delete-btn").classList.remove("hidden");
    markActive();
  }

  function sourceLabel(s) {
    return { media: "녹음·영상", youtube: "유튜브", document: "PDF·문서" }[s] || s || "";
  }
  function fillList(id, items) {
    const ul = $(id);
    ul.innerHTML = "";
    (items || []).forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    });
  }
  function toggleWrap(id, items) {
    $(id).classList.toggle("hidden", !items || items.length === 0);
  }

  /* ---------- 보관함 목록 ---------- */
  function renderList() {
    const q = $("search").value.trim().toLowerCase();
    const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt);
    const filtered = q
      ? sorted.filter((r) => searchText(r).includes(q))
      : sorted;

    const list = $("list");
    list.innerHTML = "";
    filtered.forEach((r) => {
      const li = document.createElement("li");
      li.className = "list-item" + (r.id === currentId ? " active" : "");
      li.dataset.id = r.id;
      const title = document.createElement("div");
      title.className = "it-title";
      title.textContent = r.title || "(제목 없음)";
      const meta = document.createElement("div");
      meta.className = "it-meta";
      meta.textContent = `${sourceLabel(r.source)} · ${new Date(r.createdAt).toLocaleDateString()}`;
      li.append(title, meta);
      li.addEventListener("click", () => show(r));
      list.appendChild(li);
    });

    $("empty-list").classList.toggle("hidden", filtered.length > 0);
    $("empty-list").textContent =
      records.length === 0 ? "아직 정리한 기록이 없습니다." : "검색 결과가 없습니다.";
  }

  function searchText(r) {
    return [r.title, r.summary, ...(r.keyPoints || []), ...(r.decisions || []),
      ...(r.actionItems || []), r.transcript]
      .filter(Boolean).join(" ").toLowerCase();
  }
  function markActive() {
    [...$("list").children].forEach((li) =>
      li.classList.toggle("active", li.dataset.id === currentId)
    );
  }

  function removeCurrent() {
    if (!currentId) return;
    if (!confirm("이 기록을 보관함에서 삭제할까요?")) return;
    records = records.filter((r) => r.id !== currentId);
    persist();
    currentId = null;
    $("result").classList.add("hidden");
    renderList();
  }

  /* ---------- 이벤트 ---------- */
  $("run-btn").addEventListener("click", run);
  $("delete-btn").addEventListener("click", removeCurrent);
  $("search").addEventListener("input", renderList);

  renderList();
})();
