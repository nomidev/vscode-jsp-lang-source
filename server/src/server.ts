import { fileURLToPath } from 'url';
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionList,
  Definition,
  Hover,
  DidChangeWatchedFilesNotification,
  DidChangeConfigurationNotification,
  Disposable
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { getDocumentRegions } from './embeddedSupport';
import { getHtmlCompletions, getHtmlHover, getTagCompletion, getLinkedEditingRanges } from './modes/htmlMode';
import { getDocumentFormattingEdits, getRangeFormattingEdits } from './modes/formatMode';
import { getJsCompletions, getJsHover, getJsDefinition, setGlobalScopeFiles } from './modes/javascriptMode';
import { getJspCompletions } from './modes/jspMode';
import { getTaglibCompletions, getDiscoveredTaglibSuggestions } from './modes/taglibMode';
import { TldRegistry } from './tldRegistry';
import { GlobalScopeIndex } from './globalScope';
import { CoalescingRunner } from './refreshScheduler';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const tldRegistry = new TldRegistry();
const globalScopeIndex = new GlobalScopeIndex();

let workspaceRoots: string[] = [];
let clientSupportsWatchedFiles = false;
let clientSupportsPullConfig = false;
let globalScopeFolders: string[] = [];
let formatWrapLineLength: number | undefined;
let formatWrapAttributes:
  | 'auto'
  | 'force'
  | 'force-aligned'
  | 'force-expand-multiline'
  | 'aligned-multiple'
  | 'preserve'
  | 'preserve-aligned'
  | undefined;

function toFsPath(uri: string): string | null {
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

// jsp.javascript.globalScopeFolders 설정을 읽어와 globalScopeFolders를 갱신하고,
// 그 폴더들을 다시 스캔해서 javascriptMode의 전역 스코프 파일 목록을 최신화한다.
async function refreshGlobalScope(): Promise<void> {
  if (clientSupportsPullConfig) {
    try {
      const value = await connection.workspace.getConfiguration({
        section: 'jsp.javascript.globalScopeFolders'
      });
      globalScopeFolders = Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
    } catch (err) {
      connection.console.error(`[jsp] config fetch failed: ${String(err)}`);
    }

    try {
      const wrapLen = await connection.workspace.getConfiguration({
        section: 'jsp.format.wrapLineLength'
      });
      formatWrapLineLength = typeof wrapLen === 'number' ? wrapLen : undefined;

      const wrapAttrs = await connection.workspace.getConfiguration({
        section: 'jsp.format.wrapAttributes'
      });
      formatWrapAttributes = typeof wrapAttrs === 'string' ? (wrapAttrs as typeof formatWrapAttributes) : undefined;
    } catch (err) {
      connection.console.error(`[jsp] format config fetch failed: ${String(err)}`);
    }
  }

  try {
    const result = await globalScopeIndex.scan(workspaceRoots, globalScopeFolders);
    setGlobalScopeFiles(result.files);
    warnAboutMissingFolders(result.missingFolders);
  } catch (err) {
    connection.console.error(`[jsp] global scope scan failed: ${String(err)}`);
  }

  // .js 파일 변경 감시가 필요한지는 설정값(globalScopeFolders)에 달려 있으므로 여기서 맞춘다.
  await updateFileWatchers();
}

// 파일 변경 알림이 몰릴 때 알림마다 전체 스캔을 새로 돌리지 않도록, 요청을 합치고(debounce)
// 같은 스캔이 겹쳐 돌지 않게 한다. (CoalescingRunner 설명 참고)
const tldRunner = new CoalescingRunner(
  () => tldRegistry.scanWorkspace(workspaceRoots),
  500,
  err => connection.console.error(`[jsp] tld rescan failed: ${String(err)}`)
);
const globalScopeRunner = new CoalescingRunner(
  async () => {
    // 설정 자체는 안 바뀌었으므로 workspace/configuration 을 다시 물어볼 필요는 없다.
    const result = await globalScopeIndex.scan(workspaceRoots, globalScopeFolders);
    setGlobalScopeFiles(result.files);
  },
  500,
  err => connection.console.error(`[jsp] global scope rescan failed: ${String(err)}`)
);
const configRunner = new CoalescingRunner(
  refreshGlobalScope,
  300,
  err => connection.console.error(`[jsp] config refresh failed: ${String(err)}`)
);

// 파일 감시 등록. .tld 는 항상 감시하지만 **/*.js 는 globalScopeFolders 가 설정돼 있을 때만 감시한다.
// 설정이 없으면 .js 변경은 어디에도 쓰이지 않는데, 그래도 모든 .js 변경 알림(빌드 결과물, 리소스 동기화 등)이
// 확장 호스트를 거쳐 이 서버까지 전달되기 때문에 설정이 없는 경우에는 아예 받지 않는다.
let watcherRegistration: Promise<Disposable> | undefined;
let watchingJs = false;
let watcherUpdateChain: Promise<void> = Promise.resolve();

async function applyFileWatchers(): Promise<void> {
  if (!clientSupportsWatchedFiles) return;
  const wantJs = globalScopeFolders.length > 0;
  if (watcherRegistration && watchingJs === wantJs) return; // 이미 원하는 상태

  const previous = watcherRegistration;
  watcherRegistration = undefined;
  if (previous) {
    try {
      (await previous).dispose();
    } catch {
      // 이전 등록 해제 실패는 무시 (새로 등록하면 그만)
    }
  }

  const watchers = [{ globPattern: '**/*.tld' }];
  if (wantJs) watchers.push({ globPattern: '**/*.js' });
  watchingJs = wantJs;
  watcherRegistration = connection.client.register(DidChangeWatchedFilesNotification.type, { watchers });
  watcherRegistration.catch(err => connection.console.error(`[jsp] watcher register failed: ${String(err)}`));
}

// 등록/해제가 동시에 겹치지 않게 순서대로 실행
function updateFileWatchers(): Promise<void> {
  watcherUpdateChain = watcherUpdateChain.then(applyFileWatchers).catch(() => undefined);
  return watcherUpdateChain;
}

function warnAboutMissingFolders(missingFolders: string[]): void {
  if (missingFolders.length === 0) return;
  const rootList = workspaceRoots.length > 0 ? workspaceRoots.join(', ') : '(워크스페이스 루트 없음)';
  connection.window.showWarningMessage(
    `jsp.javascript.globalScopeFolders: 다음 폴더를 워크스페이스 루트 기준으로 찾을 수 없습니다 - ${missingFolders.join(
      ', '
    )} (워크스페이스 루트: ${rootList}). 경로가 올바른지 확인해주세요.`
  );
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
  clientSupportsPullConfig = !!params.capabilities.workspace?.configuration;

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['<', '"', "'", '=', '/', ' ', '%', '@', '.', '$', '{', ':']
      },
      hoverProvider: true,
      definitionProvider: true,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      linkedEditingRangeProvider: true
    }
  };
});

connection.onInitialized(() => {
  // 워크스페이스의 .tld 파일을 비동기로 스캔 (초기 로딩을 막지 않음)
  tldRegistry.scanWorkspace(workspaceRoots).catch(err => {
    connection.console.error(`[jsp] tld scan failed: ${String(err)}`);
  });

  // jsp.javascript.globalScopeFolders 설정을 읽어 초기 스캔
  refreshGlobalScope();

  // 설정이 바뀌면(jsp.javascript.globalScopeFolders 등) 다시 읽어 재스캔
  if (clientSupportsPullConfig) {
    connection.client
      .register(DidChangeConfigurationNotification.type, {})
      .catch(err => connection.console.error(`[jsp] config watcher register failed: ${String(err)}`));
  }

  // .tld 파일(그리고 설정에 따라 .js 파일)이 추가/수정/삭제되면 다시 스캔하도록 감시 등록
  updateFileWatchers();
});

connection.onDidChangeConfiguration(() => {
  configRunner.trigger();
});

// 변경된 파일이 실제로 스캔 결과에 영향을 주는 경우에만, 그것도 합쳐서 한 번만 다시 스캔한다.
//  - .tld : 커스텀 태그 목록이 바뀔 수 있음
//  - .js  : globalScopeFolders 로 지정한 폴더 안의 파일일 때만 전역 스코프 목록이 바뀜
connection.onDidChangeWatchedFiles(params => {
  let tldChanged = false;
  let jsChanged = false;
  for (const change of params.changes) {
    const fsPath = toFsPath(change.uri);
    if (!fsPath) continue;
    const lower = fsPath.toLowerCase();
    if (lower.endsWith('.tld')) {
      tldChanged = true;
    } else if (lower.endsWith('.js') && globalScopeIndex.isInsideConfiguredFolders(fsPath, workspaceRoots, globalScopeFolders)) {
      jsChanged = true;
    }
    if (tldChanged && jsChanged) break;
  }
  if (tldChanged) tldRunner.trigger();
  if (jsChanged) globalScopeRunner.trigger();
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
      return getJsCompletions(document, regions, params.position, workspaceRoots);
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
      return getJsHover(document, regions, params.position, workspaceRoots);
    case 'html':
      return getHtmlHover(document, regions, params.position);
    default:
      return null;
  }
});

connection.onDefinition((params): Definition | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const regions = getDocumentRegions(document);
  const offset = document.offsetAt(params.position);
  const languageId = regions.getLanguageAtPosition(offset);

  switch (languageId) {
    case 'javascript':
      // <script> 안의 함수/변수 정의로 이동 (같은 문서 내 정의 + typescript 내장 lib .d.ts 정의)
      return getJsDefinition(document, regions, params.position, workspaceRoots);
    default:
      // html/jsp 영역의 정의 이동(예: 커스텀 태그 -> tld 파일)은 아직 미구현
      return null;
  }
});

connection.onDocumentFormatting(params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const regions = getDocumentRegions(document);
  return getDocumentFormattingEdits(document, regions, params.options, {
    wrapLineLength: formatWrapLineLength,
    wrapAttributes: formatWrapAttributes
  });
});

connection.onDocumentRangeFormatting(params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const regions = getDocumentRegions(document);
  return getRangeFormattingEdits(document, regions, params.range, params.options, workspaceRoots, {
    wrapLineLength: formatWrapLineLength,
    wrapAttributes: formatWrapAttributes
  });
});

// "태그 rename" - 여는/닫는 태그 이름을 동시에 편집. LSP 표준 기능이라 서버 캐퍼빌리티
// 선언 + 이 핸들러만 있으면 VS Code가 알아서 UI를 처리해준다.
connection.languages.onLinkedEditingRange(params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const regions = getDocumentRegions(document);
  return getLinkedEditingRanges(document, regions, params.position);
});

// "HTML 태그 자동완성(닫는 태그 자동 삽입)" - LSP 표준 요청이 아니라서, 클라이언트가
// '>' 나 '/' 를 타이핑한 직후 이 커스텀 요청을 보내면 스니펫 문자열을 돌려준다.
connection.onRequest(
  'jsp/tagComplete',
  (params: { textDocument: { uri: string }; position: { line: number; character: number } }) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const regions = getDocumentRegions(document);
    return getTagCompletion(document, regions, params.position);
  }
);

documents.listen(connection);
connection.listen();
