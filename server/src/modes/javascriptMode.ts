import * as ts from 'typescript';
import { CompletionList, CompletionItemKind, Hover, Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentRegions } from '../embeddedSupport';

const FILE_NAME = 'jsp-embedded-script.js';

// 문서 하나짜리 초경량 LanguageServiceHost.
// 매 요청마다 현재 임베디드(js) 텍스트를 최신 상태로 돌려준다.
function createHost(getScriptText: () => string) {
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [FILE_NAME],
    getScriptVersion: () => String(Date.now()),
    getScriptSnapshot: fileName => {
      if (fileName === FILE_NAME) {
        return ts.ScriptSnapshot.fromString(getScriptText());
      }
      return undefined;
    },
    getCurrentDirectory: () => '',
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2020,
      allowJs: true,
      checkJs: false,
      module: ts.ModuleKind.ESNext,
      lib: ['lib.es2020.d.ts', 'lib.dom.d.ts']
    }),
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: fileName => fileName === FILE_NAME || ts.sys.fileExists(fileName),
    readFile: fileName => (fileName === FILE_NAME ? getScriptText() : ts.sys.readFile(fileName)),
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories
  };
  return host;
}

let currentText = '';
const host = createHost(() => currentText);
const languageService = ts.createLanguageService(host, ts.createDocumentRegistry());

const KIND_MAP: Record<string, CompletionItemKind> = {
  [ts.ScriptElementKind.functionElement]: CompletionItemKind.Function,
  [ts.ScriptElementKind.variableElement]: CompletionItemKind.Variable,
  [ts.ScriptElementKind.memberVariableElement]: CompletionItemKind.Field,
  [ts.ScriptElementKind.memberFunctionElement]: CompletionItemKind.Method,
  [ts.ScriptElementKind.keyword]: CompletionItemKind.Keyword,
  [ts.ScriptElementKind.classElement]: CompletionItemKind.Class,
  [ts.ScriptElementKind.interfaceElement]: CompletionItemKind.Interface
};

export function getJsCompletions(
  document: TextDocument,
  regions: DocumentRegions,
  position: Position
): CompletionList {
  const embedded = regions.getEmbeddedDocument('javascript');
  currentText = embedded.getText();
  const offset = embedded.offsetAt(position);

  const completions = languageService.getCompletionsAtPosition(FILE_NAME, offset, {});
  if (!completions) return { isIncomplete: false, items: [] };

  return {
    isIncomplete: false,
    items: completions.entries.slice(0, 100).map(entry => ({
      label: entry.name,
      kind: KIND_MAP[entry.kind] ?? CompletionItemKind.Text,
      sortText: entry.sortText
    }))
  };
}

export function getJsHover(
  document: TextDocument,
  regions: DocumentRegions,
  position: Position
): Hover | null {
  const embedded = regions.getEmbeddedDocument('javascript');
  currentText = embedded.getText();
  const offset = embedded.offsetAt(position);

  const info = languageService.getQuickInfoAtPosition(FILE_NAME, offset);
  if (!info) return null;

  const text = ts.displayPartsToString(info.displayParts);
  return {
    contents: { kind: 'markdown', value: '```typescript\n' + text + '\n```' }
  };
}
