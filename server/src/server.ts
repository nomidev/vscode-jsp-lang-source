import { fileURLToPath } from 'url';
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionList,
  Hover,
  DidChangeWatchedFilesNotification
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { getDocumentRegions } from './embeddedSupport';
import { getHtmlCompletions, getHtmlHover } from './modes/htmlMode';
import { getJsCompletions, getJsHover } from './modes/javascriptMode';
import { getJspCompletions } from './modes/jspMode';
import { getTaglibCompletions, getDiscoveredTaglibSuggestions } from './modes/taglibMode';
import { TldRegistry } from './tldRegistry';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const tldRegistry = new TldRegistry();

let workspaceRoots: string[] = [];
let clientSupportsWatchedFiles = false;

function toFsPath(uri: string): string | null {
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  if (params.workspaceFolders?.length) {
    workspaceRoots = params.workspaceFolders
      .map(f => toFsPath(f.uri))
      .filter((p): p is string => p !== null);
  } else if (params.rootUri) {
    const p = toFsPath(params.rootUri);
    if (p) workspaceRoots = [p];
  } else if (params.rootPath) {
    workspaceRoots = [params.rootPath];
  }

  clientSupportsWatchedFiles =
    !!params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration;

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['<', '"', "'", '=', '/', ' ', '%', '@', '.', '$', '{', ':']
      },
      hoverProvider: true
    }
  };
});

connection.onInitialized(() => {
  // 워크스페이스의 .tld 파일을 비동기로 스캔 (초기 로딩을 막지 않음)
  tldRegistry.scanWorkspace(workspaceRoots).catch(err => {
    connection.console.error(`[jsp] tld scan failed: ${String(err)}`);
  });

  // .tld 파일이 추가/수정/삭제되면 다시 스캔하도록 감시 등록
  if (clientSupportsWatchedFiles) {
    connection.client
      .register(DidChangeWatchedFilesNotification.type, {
        watchers: [{ globPattern: '**/*.tld' }]
      })
      .catch(err => connection.console.error(`[jsp] watcher register failed: ${String(err)}`));
  }
});

connection.onDidChangeWatchedFiles(() => {
  tldRegistry.scanWorkspace(workspaceRoots).catch(err => {
    connection.console.error(`[jsp] tld rescan failed: ${String(err)}`);
  });
});

connection.onCompletion((params): CompletionList => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return { isIncomplete: false, items: [] };

  const offset = document.offsetAt(params.position);

  // 커스텀 태그(prefix:tag) 이름/속성 자리인지 먼저 확인 - html 스캐너가 알아채지 못하는 영역이라 우선 처리
  const taglibCompletions = getTaglibCompletions(document, tldRegistry, offset);
  if (taglibCompletions) return taglibCompletions;

  const regions = getDocumentRegions(document);
  const languageId = regions.getLanguageAtPosition(offset);

  switch (languageId) {
    case 'javascript':
      return getJsCompletions(document, regions, params.position);
    case 'jsp':
      return getJspCompletions(document, params.position, getDiscoveredTaglibSuggestions(tldRegistry));
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
