// A directory page can be valid text but the wrong source for a selected work.
// Reject clear index titles before a paid model call, without requiring exact
// title equality (publishers often add subtitles or their site name).
const INDEX=/^(?:transcripts?|archives?|articles?|podcasts?|all (?:articles|posts)|녹취록 모음|대본 목록|자료 목록)(?:\s*[—–|:\-].*)?$/i;
export function assertArticleSource({title='',text=''},expectedTitle='') {
 if(typeof expectedTitle!=='string')throw Error('요청 제목 형식이 올바르지 않습니다.');
 if(expectedTitle.trim()&&INDEX.test(title.trim())&&!INDEX.test(expectedTitle.trim())){
  throw Error('요청한 글 대신 목록 페이지를 가져왔습니다. 목록에서 해당 글의 본문 또는 PDF 링크를 열어 다시 증류해주세요. 기존 서재 본문은 유지됩니다.');
 }
 if(!text?.trim())throw Error('원문 본문이 없습니다.');
}
export function pdfTextContent(text='') {
 return text.replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm,'').trim();
}
