import {
  getLanguageService as getHTMLLanguageService,
  LanguageService as HTMLLanguageService
} from 'vscode-html-languageservice';
import { CompletionList, FormattingOptions, Hover, Position, TextEdit } from 'vscode-languageserver';
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

// JSP의 <% %> 스크립틀릿/<%= %>/<%@ %> 문법은 Ruby ERB의 <% %> 문법과 동일한 형태라서,
// html-languageservice의 내장 포매터에 templating: ['erb']를 주면 이 블록들을
// 온전한 하나의 토큰으로 인식해 내부를 건드리지 않고 통과시킨다.
// (직접 검증: 이 옵션 없이는 "!= null" 같은 스크립틀릿 내부 코드의 공백이 깨지고,
//  중첩된 <% %> 블록마다 들여쓰기가 끝없이 깊어지는 문제가 있었음)
export function getDocumentFormattingEdits(document: TextDocument, options: FormattingOptions): TextEdit[] {
  return htmlLanguageService.format(document, undefined, {
    tabSize: options.tabSize,
    insertSpaces: options.insertSpaces,
    templating: ['erb']
  });
}
