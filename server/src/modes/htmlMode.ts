import {
  getLanguageService as getHTMLLanguageService,
  LanguageService as HTMLLanguageService
} from 'vscode-html-languageservice';
import { CompletionList, Hover, Position } from 'vscode-languageserver';
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
