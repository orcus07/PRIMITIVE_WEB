// Shared by the server and browser. Signals request review; they do not prove omission.
(function (root) {
  function assess(record, stopReason) {
    const issues = [];
    const sections = record?.sections;
    if (!Array.isArray(sections) || !sections.length) {
      return { status: 'review', issues: [{ section: null, signals: ['본문 없음'], review: true }] };
    }
    const lengths = sections.map(s => typeof s?.content === 'string' ? s.content.trim().length : 0).sort((a,b) => a-b);
    const median = lengths[Math.floor(lengths.length / 2)];
    sections.forEach((s, i) => {
      const text = typeof s?.content === 'string' ? s.content.trim() : '';
      const original = typeof s?.original === 'string' ? s.original.trim() : '';
      const signals = [];
      if (!text) signals.push('본문 없음');
      const unfinished = !!text && (!/[.!?。…]["'”’）)\]]*$/.test(text) && !/다["'”’）)\]]*$/.test(text));
      const open = [...text].filter(c => '([（'.includes(c)).length > [...text].filter(c => ')]）'.includes(c)).length;
      if (unfinished || open) signals.push('문장 중단 가능성');
      if (text && median >= 100 && text.length < Math.max(40, median * 0.25)) signals.push('다른 구간보다 짧음');
      if (!original) signals.push('대응 원문 없음');
      // A short caption or missing excerpt alone is a warning, not a rejection.
      const review = !text || ((unfinished || open) && !original) || (open && signals.includes('다른 구간보다 짧음'));
      if (signals.length) issues.push({ section: i, signals, review });
    });
    if (stopReason && stopReason !== 'end_turn') issues.push({ section: null, signals: ['모델 종료: ' + stopReason], review: true });
    return { status: issues.some(i => i.review) ? 'review' : issues.length ? 'warning' : 'checked', issues };
  }
  function parseResponse(message) {
    const raw = (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let result;
    try { result = JSON.parse(raw); } catch {
      const error = new Error('응답 JSON을 해석하지 못했습니다 (종료: ' + (message.stop_reason || 'unknown') + '). 전체 재증류는 자동 실행하지 않습니다.');
      error.noRetry = true;
      throw error;
    }
    const generation = { stopReason: message.stop_reason || 'unknown', model: message.model || '', usage: message.usage || {}, responseId: message.id || '' };
    return { ...result, generation, quality: assess(result, generation.stopReason) };
  }
  root.ReaderQuality = { assess, parseResponse };
})(globalThis);
