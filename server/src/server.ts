import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionList,
  Hover
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { getDocumentRegions } from './embeddedSupport';
import { getHtmlCompletions, getHtmlHover } from './modes/htmlMode';
import { getJsCompletions, getJsHover } from './modes/javascriptMode';
import { getJspCompletions } from './modes/jspMode';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['<', '"', "'", '=', '/', ' ', '%', '@', '.', '$', '{']
      },
      hoverProvider: true
    }
  };
});

connection.onCompletion((params): CompletionList => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return { isIncomplete: false, items: [] };

  const regions = getDocumentRegions(document);
  const offset = document.offsetAt(params.position);
  const languageId = regions.getLanguageAtPosition(offset);

  switch (languageId) {
    case 'javascript':
      return getJsCompletions(document, regions, params.position);
    case 'jsp':
      return getJspCompletions(document, params.position);
    case 'html':
    default:
      return getHtmlCompletions(document, regions, params.position);
  }
});

connection.onHover((params): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const regions = getDocumentRegions(document);
  const offset = document.offsetAt(params.position);
  const languageId = regions.getLanguageAtPosition(offset);

  switch (languageId) {
    case 'javascript':
      return getJsHover(document, regions, params.position);
    case 'html':
      return getHtmlHover(document, regions, params.position);
    default:
      return null;
  }
});

documents.listen(connection);
connection.listen();
