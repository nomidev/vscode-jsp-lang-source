import { TextDocument } from 'vscode-languageserver-textdocument';
import { Range } from 'vscode-languageserver';
import {
  getLanguageService as getHTMLLanguageService,
  TokenType
} from 'vscode-html-languageservice';

export type EmbeddedLanguageId = 'html' | 'javascript' | 'css' | 'jsp';

export interface EmbeddedRegion {
  languageId: EmbeddedLanguageId;
  start: number;
  end: number;
}

export interface DocumentRegions {
  getLanguageAtPosition(offset: number): EmbeddedLanguageId;
  getEmbeddedDocument(languageId: EmbeddedLanguageId): TextDocument;
}

const htmlLanguageService = getHTMLLanguageService();

// <%-- --%>, <%@ ... %>, <%! ... %>, <%= ... %>, <% ... %> 를 모두 잡는다.
const JSP_BLOCK_REGEX = /<%(--)?[\s\S]*?(--)?%>/g;

/**
 * 원본 텍스트에서 JSP 블록만 남기고 나머지는 같은 길이의 공백/개행으로 치환한다.
 * (오프셋을 유지해야 위치 매핑이 정확하게 유지된다)
 */
function maskExcept(text: string, keepRanges: { start: number; end: number }[]): string {
  const chars = text.split('');
  let lastEnd = 0;
  for (const r of keepRanges) {
    for (let i = lastEnd; i < r.start; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
    lastEnd = r.end;
  }
  for (let i = lastEnd; i < chars.length; i++) {
    if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  }
  return chars.join('');
}

function maskOnly(text: string, blankRanges: { start: number; end: number }[]): string {
  const chars = text.split('');
  for (const r of blankRanges) {
    for (let i = r.start; i < r.end; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  }
  return chars.join('');
}

export function getDocumentRegions(document: TextDocument): DocumentRegions {
  const text = document.getText();
  const regions: EmbeddedRegion[] = [];

  // 1) JSP 블록 먼저 수집
  const jspRanges: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  JSP_BLOCK_REGEX.lastIndex = 0;
  while ((m = JSP_BLOCK_REGEX.exec(text))) {
    jspRanges.push({ start: m.index, end: m.index + m[0].length });
    regions.push({ languageId: 'jsp', start: m.index, end: m.index + m[0].length });
  }

  // 2) JSP 블록을 공백 처리한 텍스트로 HTML 스캐너를 돌려 <script>/<style> 영역 탐지
  const htmlScanText = maskOnly(text, jspRanges);
  const scanner = htmlLanguageService.createScanner(htmlScanText);
  let token = scanner.scan();
  while (token !== TokenType.EOS) {
    if (token === TokenType.Script) {
      regions.push({
        languageId: 'javascript',
        start: scanner.getTokenOffset(),
        end: scanner.getTokenEnd()
      });
    } else if (token === TokenType.Styles) {
      regions.push({
        languageId: 'css',
        start: scanner.getTokenOffset(),
        end: scanner.getTokenEnd()
      });
    }
    token = scanner.scan();
  }

  regions.sort((a, b) => a.start - b.start);

  return {
    getLanguageAtPosition(offset: number): EmbeddedLanguageId {
      for (const r of regions) {
        if (offset >= r.start && offset <= r.end) return r.languageId;
      }
      return 'html';
    },
    getEmbeddedDocument(languageId: EmbeddedLanguageId): TextDocument {
      const keep = regions.filter(r => r.languageId === languageId);
      let content: string;
      if (languageId === 'html') {
        // html 문서 = jsp/js/css 블록을 공백 처리한 나머지 전체
        content = maskOnly(
          text,
          regions.filter(r => r.languageId !== 'html').map(r => ({ start: r.start, end: r.end }))
        );
      } else {
        content = maskExcept(text, keep);
      }
      const virtualLangId =
        languageId === 'jsp' ? 'jsp' : languageId; // jsp는 자체 provider가 처리
      return TextDocument.create(
        `embedded://${virtualLangId}/${encodeURIComponent(document.uri)}`,
        virtualLangId,
        document.version,
        content
      );
    }
  };
}

export function toRange(document: TextDocument, start: number, end: number): Range {
  return { start: document.positionAt(start), end: document.positionAt(end) };
}
