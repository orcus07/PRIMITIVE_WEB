// Private snapshots stay in this browser; only authenticated PC endpoints supply taste.
(() => {
  const KEY = 'reader-library-perspective/v1', OLD = 'reader-perspective/v1';
  let state = { mode: 'library', cache: null, custom: '' }, connection = '확인 중';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) state = JSON.parse(saved);
    else {
      const old = localStorage.getItem(OLD), auto = localStorage.getItem('reader-profile-last/v1');
      if (old?.trim() && old !== auto) state = { ...state, mode: 'custom', custom: old };
    }
  } catch {}
  const input = () => document.getElementById('lens-input');
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; } }
  function render() {
    input().value = state.mode === 'custom' ? state.custom : state.cache?.perspective || '';
    const saved = state.cache?.savedAt ? new Date(state.cache.savedAt).toLocaleString() : '없음';
    document.getElementById('profile-status').textContent = `${state.mode === 'custom' ? '직접 설정한 관점' : '서재 취향 (기본)'} · PC ${connection} · 마지막 정상 동기화: ${saved}` + (!state.cache && state.mode === 'library' ? ' · 서재에서 자료를 열어 인증 연결이 필요합니다.' : '');
  }
  function custom() { state.mode = 'custom'; state.custom = input().value; persist(); render(); }
  async function refresh() {
    connection = '확인 중'; render();
    try {
      const value = await window.PensieveSync.perspective();
      if (!value?.perspective?.trim()) throw Error('관점 없음');
      state.cache = { perspective: value.perspective, savedAt: new Date().toISOString(), evidenceAt: value.evidenceAt || null };
      connection = persist() ? '연결됨' : '연결됨 (브라우저 저장 실패)';
    } catch { connection = '연결 안 됨'; }
    render();
  }
  window.ReaderPerspective = {
    get() {
      const value = input().value.trim();
      if (!value && state.mode === 'library') throw Error('서재 취향이 아직 없습니다. 서재에서 자료를 열어 연결하거나 관점을 직접 입력해주세요.');
      return value;
    },
    custom, refresh,
    setLaunch(text) { if (state.mode !== 'custom' && text) { input().value = text; document.getElementById('profile-status').textContent += ' · 이번 자료의 서재 관점 적용'; } },
    init() {
      render();
      input().addEventListener('input', custom);
      document.getElementById('lens-reset').onclick = () => { state.mode = 'library'; persist(); refresh(); };
      document.getElementById('lens-refresh').onclick = refresh;
      return refresh();
    }
  };
})();
