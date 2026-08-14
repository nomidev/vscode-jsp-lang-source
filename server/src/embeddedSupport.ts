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
  /** 'script-body'는 실제 <script>...</script> 본문, 'attribute-expr'은 @click 같은 속성값 조각 */
  kind?: 'script-body' | 'attribute-expr';
}

export interface DocumentRegions {
  getLanguageAtPosition(offset: number): EmbeddedLanguageId;
  getEmbeddedDocument(languageId: EmbeddedLanguageId): TextDocument;
  /** <script src="..."> 로 참조된 외부 JS 파일 경로(원본 문자열, 미해석) 목록 */
  getImportedScripts(): string[];
  /** 실제 <script>...</script> 본문 범위만 (Vue 속성값 조각 제외) - 서식 정렬용 */
  getScriptBodyRanges(): { start: number; end: number }[];
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

// Vue 디렉티브(v-on:click, @click, v-bind:foo, :foo, v-model, v-if, ...)나
// 표준 이벤트 핸들러(onclick, onchange, ...) 속성의 값은 JS 표현식이므로,
// <script> 본문과 마찬가지로 JS 언어 서비스가 다루도록 인식한다.
function isJsExpressionAttribute(attrName: string): boolean {
  const lower = attrName.toLowerCase();
  if (lower.startsWith('on') && lower.length > 2) return true; // onclick, onchange, ...
  if (attrName.startsWith('@')) return true; // @click (v-on 단축 문법)
  if (attrName.startsWith(':') && attrName.length > 1) return true; // :disabled (v-bind 단축 문법)
  if (/^v-[\w-]+/.test(attrName)) return true; // v-model, v-if, v-on:click, v-bind:foo, ...
  return false;
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

  // 2) JSP 블록을 공백 처리한 텍스트로 HTML 스캐너를 돌려 <script>/<style> 영역 및 <script src="...">를 탐지
  const importedScripts: string[] = [];
  const htmlScanText = maskOnly(text, jspRanges);
  const scanner = htmlLanguageService.createScanner(htmlScanText);
  let lastTagName = '';
  let lastAttributeName: string | undefined;
  let token = scanner.scan();
  while (token !== TokenType.EOS) {
    switch (token) {
      case TokenType.StartTag:
        lastTagName = scanner.getTokenText();
        lastAttributeName = undefined;
        break;
      case TokenType.Script:
        regions.push({
          languageId: 'javascript',
          start: scanner.getTokenOffset(),
          end: scanner.getTokenEnd(),
          kind: 'script-body'
        });
        break;
      case TokenType.Styles:
        regions.push({
          languageId: 'css',
          start: scanner.getTokenOffset(),
          end: scanner.getTokenEnd()
        });
        break;
      case TokenType.AttributeName:
        lastAttributeName = scanner.getTokenText();
        break;
      case TokenType.AttributeValue: {
        if (lastAttributeName === 'src' && lastTagName.toLowerCase() === 'script') {
          let value = scanner.getTokenText();
          if (value.length >= 2 && (value[0] === '"' || value[0] === "'")) {
            value = value.substring(1, value.length - 1);
          }
          if (value) importedScripts.push(value);
        } else if (lastAttributeName && isJsExpressionAttribute(lastAttributeName)) {
          const raw = scanner.getTokenText();
          const start = scanner.getTokenOffset();
          const end = scanner.getTokenEnd();
          // 따옴표를 뺀 내부 텍스트만 JS 영역으로 추가 (따옴표 자체는 JS가 아니므로)
          const hasQuotes = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'");
          const innerStart = hasQuotes ? start + 1 : start;
          const innerEnd = hasQuotes ? end - 1 : end;
          if (innerEnd > innerStart) {
            regions.push({
              languageId: 'javascript',
              start: innerStart,
              end: innerEnd,
              kind: 'attribute-expr'
            });
          }
        }
        lastAttributeName = undefined;
        break;
      }
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
    },
    getImportedScripts(): string[] {
      return importedScripts;
    },
    getScriptBodyRanges(): { start: number; end: number }[] {
      return regions
        .filter(r => r.kind === 'script-body')
        .map(r => ({ start: r.start, end: r.end }));
    }
  };
}

export function toRange(document: TextDocument, start: number, end: number): Range {
  return { start: document.positionAt(start), end: document.positionAt(end) };
}
