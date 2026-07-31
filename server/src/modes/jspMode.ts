import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  InsertTextFormat,
  Position
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

// <%@ page %>, <%@ include %>, <%@ taglib %> 의 대표 속성들.
// 실제 프로젝트에 맞게 얼마든지 확장 가능.
const PAGE_ATTRS = [
  'contentType', 'pageEncoding', 'import', 'session', 'buffer',
  'autoFlush', 'isErrorPage', 'errorPage', 'isELIgnored', 'language'
];
const TAGLIB_ATTRS = ['uri', 'prefix', 'tagdir'];
const INCLUDE_ATTRS = ['file'];
const DIRECTIVES = ['page', 'include', 'taglib', 'attribute', 'variable', 'tag'];

const COMMON_TAGLIBS = [
  { prefix: 'c', uri: 'http://java.sun.com/jsp/jstl/core' },
  { prefix: 'fmt', uri: 'http://java.sun.com/jsp/jstl/fmt' },
  { prefix: 'fn', uri: 'http://java.sun.com/jsp/jstl/functions' }
];

export function getJspCompletions(
  document: TextDocument,
  position: Position,
  discoveredTaglibs: { prefix: string; uri: string }[] = []
): CompletionList {
  const offset = document.offsetAt(position);
  const text = document.getText();
  const before = text.slice(Math.max(0, offset - 200), offset);

  // <%@ 로 시작하는 블록 안인지 확인
  const directiveStart = before.lastIndexOf('<%@');
  const blockClosed = before.lastIndexOf('%>');
  const insideDirective = directiveStart !== -1 && directiveStart > blockClosed;

  if (!insideDirective) {
    return { isIncomplete: false, items: [] };
  }

  const directiveText = before.slice(directiveStart);

  // "page ", "include ", "taglib " 중 어떤 지시어인지 판별
  const dirMatch = /^<%@\s*(page|include|taglib|attribute|variable|tag)\b/.exec(directiveText);

  if (!dirMatch) {
    return {
      isIncomplete: false,
      items: DIRECTIVES.map(d => ({ label: d, kind: CompletionItemKind.Keyword }))
    };
  }

  const kind = dirMatch[1];
  let attrs: string[] = [];
  if (kind === 'page') attrs = PAGE_ATTRS;
  else if (kind === 'taglib') attrs = TAGLIB_ATTRS;
  else if (kind === 'include') attrs = INCLUDE_ATTRS;

  const items: CompletionItem[] = attrs.map(a => ({
    label: a,
    kind: CompletionItemKind.Property,
    insertText: `${a}="$1"`,
    insertTextFormat: InsertTextFormat.Snippet
  }));

  if (kind === 'taglib') {
    const seen = new Set<string>();
    for (const t of [...COMMON_TAGLIBS, ...discoveredTaglibs]) {
      if (seen.has(t.uri)) continue;
      seen.add(t.uri);
      items.push({
        label: `${t.prefix} (${t.uri})`,
        kind: CompletionItemKind.Snippet,
        insertText: `prefix="${t.prefix}" uri="${t.uri}"`,
        insertTextFormat: InsertTextFormat.Snippet
      });
    }
  }

  return { isIncomplete: false, items };
}
