import {
  getLanguageService as getHTMLLanguageService,
  LanguageService as HTMLLanguageService,
  TokenType
} from 'vscode-html-languageservice';
import { FormattingOptions, TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentRegions } from '../embeddedSupport';
import { formatJsSnippet } from './javascriptMode';

const htmlLanguageService: HTMLLanguageService = getHTMLLanguageService();

export interface FormatOverrides {
  /** 0이면 줄바꿈 없음. jsp.format.wrapLineLength 설정값 */
  wrapLineLength?: number;
  /** jsp.format.wrapAttributes 설정값 */
  wrapAttributes?:
    | 'auto'
    | 'force'
    | 'force-aligned'
    | 'force-expand-multiline'
    | 'aligned-multiple'
    | 'preserve'
    | 'preserve-aligned';
}

function applyTextEdits(text: string, edits: TextEdit[]): string {
  const doc = TextDocument.create('inmemory://format-temp', 'html', 1, text);
  const sorted = [...edits].sort(
    (a, b) => doc.offsetAt(b.range.start) - doc.offsetAt(a.range.start)
  );
  let result = text;
  for (const edit of sorted) {
    const start = doc.offsetAt(edit.range.start);
    const end = doc.offsetAt(edit.range.end);
    result = result.slice(0, start) + edit.newText + result.slice(end);
  }
  return result;
}

// text 안의 <script>...</script> 본문 범위들을 등장 순서대로 반환한다 (스캐너 직접 사용).
function findScriptBodyRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const scanner = htmlLanguageService.createScanner(text);
  let token = scanner.scan();
  while (token !== TokenType.EOS) {
    if (token === TokenType.Script) {
      ranges.push({ start: scanner.getTokenOffset(), end: scanner.getTokenEnd() });
    }
    token = scanner.scan();
  }
  return ranges;
}

// offset이 속한 줄의 맨 앞 공백/탭 개수를 "칸 수"로 환산한다 (tab은 tabSize칸으로 취급).
// offset 자체가 그 줄의 어디에 있든 상관없이 줄 맨 앞부터의 "들여쓰기"만 계산한다.
function lineIndentColumns(text: string, offset: number, tabSize: number): number {
  let lineStart = offset;
  while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--;
  let columns = 0;
  let i = lineStart;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
    columns += text[i] === '\t' ? tabSize : 1;
    i++;
  }
  return columns;
}

/**
 * JSP 문서 전체를 정렬한다.
 * 1) 원본 문서를 templating:'erb' 옵션으로 HTML 포매터에 그대로 넘겨 구조를 정렬한다.
 *    (JSP의 <% %> 계열 문법이 Ruby ERB와 동일한 형태라서 이 옵션으로 스크립틀릿이
 *    안전하게 하나의 토큰으로 보존된다 - 마스킹된 문서를 쓰면 JSP 블록 자체가
 *    사라지는 문제가 있어 반드시 원본 문서를 사용해야 한다)
 * 2) <script> 내부는 HTML 포매터가 뭘 하든 상관없이, 아래에서 원본 JS 코드를
 *    TypeScript 자체 포맷 기능으로 정렬해 그 자리에 통째로 덮어써 넣는다.
 * 두 단계가 서로 다른 텍스트 좌표계를 거치므로, 최종적으로는
 * "문서 전체를 이 텍스트로 교체" 라는 단일 TextEdit 하나로 반환한다.
 */
export function getDocumentFormattingEdits(
  document: TextDocument,
  regions: DocumentRegions,
  options: FormattingOptions,
  overrides: FormatOverrides = {}
): TextEdit[] {
  const htmlEdits = htmlLanguageService.format(document, undefined, {
    tabSize: options.tabSize,
    insertSpaces: options.insertSpaces,
    templating: ['erb'],
    ...(overrides.wrapLineLength !== undefined ? { wrapLineLength: overrides.wrapLineLength } : {}),
    ...(overrides.wrapAttributes !== undefined ? { wrapAttributes: overrides.wrapAttributes } : {})
  });
  let structuredText = applyTextEdits(document.getText(), htmlEdits);

  const originalRanges = regions.getScriptBodyRanges();
  const newRanges = findScriptBodyRanges(structuredText);
  const pairCount = Math.min(originalRanges.length, newRanges.length);

  const originalText = document.getText();

  // 뒤에서부터 처리해야 앞쪽 스플라이스가 뒤쪽 오프셋을 안 깨뜨린다
  for (let i = pairCount - 1; i >= 0; i--) {
    const original = originalRanges[i];
    const target = newRanges[i];
    const rawJs = originalText.slice(original.start, original.end).trim();
    if (!rawJs) continue; // 빈 <script></script>는 건드릴 필요 없음

    const scriptTagIndent = lineIndentColumns(structuredText, target.start, options.tabSize);
    const contentIndent = scriptTagIndent + options.tabSize;
    const formatted = formatJsSnippet(rawJs, contentIndent, options);
    const indentStr = options.insertSpaces
      ? ' '.repeat(scriptTagIndent)
      : '\t'.repeat(Math.floor(scriptTagIndent / options.tabSize));

    const replacement = `\n${formatted}\n${indentStr}`;
    structuredText =
      structuredText.slice(0, target.start) + replacement + structuredText.slice(target.end);
  }

  return [
    {
      range: { start: document.positionAt(0), end: document.positionAt(originalText.length) },
      newText: structuredText
    }
  ];
}
