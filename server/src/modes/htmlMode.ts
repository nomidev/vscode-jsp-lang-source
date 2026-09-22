import {
  getLanguageService as getHTMLLanguageService,
  LanguageService as HTMLLanguageService
} from 'vscode-html-languageservice';
import { CompletionList, Hover, LinkedEditingRanges, Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentRegions } from '../embeddedSupport';

const htmlLanguageService: HTMLLanguageService = getHTMLLanguageService();

export function getHtmlCompletions(
  document: TextDocument,
  regions: DocumentRegions,
  position: Position
): CompletionList {
  const embedded = regions.getEmbeddedDocument('html');
  const htmlDoc = htmlLanguageService.parseHTMLDocument(embedded);
  return htmlLanguageService.doComplete(embedded, position, htmlDoc);
}

export function getHtmlHover(
  document: TextDocument,
  regions: DocumentRegions,
  position: Position
): Hover | null {
  const embedded = regions.getEmbeddedDocument('html');
  const htmlDoc = htmlLanguageService.parseHTMLDocument(embedded);
  return htmlLanguageService.doHover(embedded, position, htmlDoc) ?? null;
}

// "HTML 태그 자동완성(닫는 태그 자동 삽입)" - <div>를 다 치고 '>' 를 입력한 직후,
// 또는 </ 까지 입력한 직후 호출된다. LSP 표준 요청이 아니라서(VS Code 내장 HTML
// 확장도 커스텀 요청으로 구현한다) 클라이언트가 타이핑을 감지해서 직접 요청을 보낸다.
// taglib 커스텀 태그(<my:foo>)도 그대로 지원된다.
export function getTagCompletion(
  document: TextDocument,
  regions: DocumentRegions,
  position: Position
): string | null {
  const embedded = regions.getEmbeddedDocument('html');
  const htmlDoc = htmlLanguageService.parseHTMLDocument(embedded);
  return htmlLanguageService.doTagComplete(embedded, position, htmlDoc);
}

// "태그 rename(여는/닫는 태그 이름 동시 편집)" - LSP 표준 Linked Editing Range 기능.
// VS Code가 이 캐퍼빌리티를 보면 알아서 커서가 태그 이름 위에 있을 때 짝지어진
// 태그 이름도 같이 편집되게 해준다. taglib 커스텀 태그도 그대로 지원된다.
export function getLinkedEditingRanges(
  document: TextDocument,
  regions: DocumentRegions,
  position: Position
): LinkedEditingRanges | null {
  const embedded = regions.getEmbeddedDocument('html');
  const htmlDoc = htmlLanguageService.parseHTMLDocument(embedded);
  const ranges = htmlLanguageService.findLinkedEditingRanges(embedded, position, htmlDoc);
  if (!ranges) return null;
  return { ranges };
}
