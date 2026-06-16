// 회의록 작성기 — 데이터는 브라우저 localStorage에 저장됩니다.
(function () {
  "use strict";

  const STORAGE_KEY = "meeting-minutes/v1";

  // 폼 필드 정의 (id == 데이터 키)
  const FIELDS = ["title", "date", "attendees", "agenda", "discussion", "decisions", "actions"];

  // DOM 참조
  const $ = (id) => document.getElementById(id);
  const form = $("form");
  const listEl = $("list");
  const emptyListEl = $("empty-list");
  const searchEl = $("search");
  const statusEl = $("status");
  const deleteBtn = $("delete-btn");

  let records = load();
  let currentId = null;

  /* ---------- 저장소 ---------- */
  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }
  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  /* ---------- 폼 헬퍼 ---------- */
  function readForm() {
    const data = {};
    FIELDS.forEach((f) => (data[f] = $(f).value.trim()));
    return data;
  }
  function fillForm(record) {
    FIELDS.forEach((f) => ($(f).value = record ? record[f] || "" : ""));
  }
  function clearForm() {
    currentId = null;
    fillForm(null);
    $("date").value = new Date().toISOString().slice(0, 10);
    deleteBtn.classList.add("hidden");
    setActive(null);
    $("title").focus();
  }

  function flash(msg) {
    statusEl.textContent = msg;
    setTimeout(() => {
      if (statusEl.textContent === msg) statusEl.textContent = "";
    }, 2000);
  }

  /* ---------- 목록 렌더링 ---------- */
  function render() {
    const q = searchEl.value.trim().toLowerCase();
    const sorted = [...records].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const filtered = q
      ? sorted.filter((r) =>
          FIELDS.some((f) => (r[f] || "").toLowerCase().includes(q))
        )
      : sorted;

    listEl.innerHTML = "";
    filtered.forEach((r) => {
      const li = document.createElement("li");
      li.className = "list-item" + (r.id === currentId ? " active" : "");
      li.dataset.id = r.id;
      const title = document.createElement("div");
      title.className = "item-title";
      title.textContent = r.title || "(제목 없음)";
      const date = document.createElement("div");
      date.className = "item-date";
      date.textContent = r.date || "";
      li.append(title, date);
      li.addEventListener("click", () => open(r.id));
      listEl.appendChild(li);
    });

    emptyListEl.classList.toggle("hidden", filtered.length > 0);
    if (filtered.length === 0) {
      emptyListEl.textContent = records.length === 0
        ? "저장된 회의록이 없습니다."
        : "검색 결과가 없습니다.";
    }
  }

  function setActive(id) {
    [...listEl.children].forEach((li) =>
      li.classList.toggle("active", li.dataset.id === id)
    );
  }

  /* ---------- 동작 ---------- */
  function open(id) {
    const record = records.find((r) => r.id === id);
    if (!record) return;
    currentId = id;
    fillForm(record);
    deleteBtn.classList.remove("hidden");
    setActive(id);
  }

  function save(e) {
    e.preventDefault();
    const data = readForm();
    if (!data.title) {
      flash("제목을 입력하세요.");
      return;
    }
    if (currentId) {
      const idx = records.findIndex((r) => r.id === currentId);
      records[idx] = Object.assign({}, records[idx], data, { updatedAt: Date.now() });
    } else {
      currentId = "m_" + Date.now().toString(36);
      records.push(Object.assign({ id: currentId, createdAt: Date.now() }, data));
    }
    persist();
    render();
    setActive(currentId);
    deleteBtn.classList.remove("hidden");
    flash("저장되었습니다 ✓");
  }

  function remove() {
    if (!currentId) return;
    if (!confirm("이 회의록을 삭제할까요?")) return;
    records = records.filter((r) => r.id !== currentId);
    persist();
    clearForm();
    render();
    flash("삭제되었습니다.");
  }

  function toPlainText() {
    const d = readForm();
    const lines = [
      `# ${d.title || "(제목 없음)"}`,
      `날짜: ${d.date}`,
      `참석자: ${d.attendees}`,
      "",
      "## 안건",
      d.agenda,
      "",
      "## 논의 내용",
      d.discussion,
      "",
      "## 결정 사항",
      d.decisions,
      "",
      "## 실행 항목",
      d.actions,
    ];
    return lines.join("\n");
  }

  function exportText() {
    const d = readForm();
    if (!d.title) {
      flash("먼저 제목을 입력하세요.");
      return;
    }
    const blob = new Blob([toPlainText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${d.title || "회의록"}_${d.date || ""}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- 이벤트 바인딩 ---------- */
  form.addEventListener("submit", save);
  deleteBtn.addEventListener("click", remove);
  $("new-btn").addEventListener("click", clearForm);
  $("print-btn").addEventListener("click", () => window.print());
  $("export-btn").addEventListener("click", exportText);
  searchEl.addEventListener("input", render);

  // 초기화
  clearForm();
  render();
})();
