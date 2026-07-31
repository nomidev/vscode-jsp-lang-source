import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { CompletionList, CompletionItemKind, Hover, Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentRegions } from '../embeddedSupport';

const FILE_NAME = 'jsp-embedded-script.js';

// esbuild로 번들된 뒤에도 __dirname은 실제 server/out 위치를 그대로 가리킨다.
// build 시점에 esbuild.js가 typescript/lib/*.d.ts 를 여기로 복사해 둔다.
const LIB_DIR = path.join(__dirname, 'typescript-libs');
const DOM_LIB_PATH = path.join(LIB_DIR, 'lib.dom.d.ts');

let currentText = '';
let scriptVersion = 0;

// 문서 하나짜리 초경량 LanguageServiceHost.
// - 스크립트 파일: 매 요청 시 최신 텍스트로 갱신
// - lib 파일: 실제 typescript-libs 디렉토리에서 그대로 읽어온다 (ts.sys에 의존하지 않음 -> 번들 후에도 안전)
function createHost(): ts.LanguageServiceHost {
  return {
    getScriptFileNames: () => [FILE_NAME, DOM_LIB_PATH],
    getScriptVersion: fileName => (fileName === FILE_NAME ? String(scriptVersion) : '1'),
    getScriptSnapshot: fileName => {
      if (fileName === FILE_NAME) return ts.ScriptSnapshot.fromString(currentText);
      if (fs.existsSync(fileName)) return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
      return undefined;
    },
    getCurrentDirectory: () => '',
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2020,
      allowJs: true,
      checkJs: false,
      module: ts.ModuleKind.ESNext
      // lib 옵션은 지정하지 않는다. target(ES2020)에 대응하는 기본 lib는
      // getDefaultLibFileName이 가리키는 typescript-libs 안의 파일로 자동 로드되고,
      // DOM 타입(window/document 등)은 getScriptFileNames에 lib.dom.d.ts를 추가로
      // 얹어서 전역 선언으로 병합되게 한다.
    }),
    // typescript.js가 require()로 번들되어 있어 실제 파일 시스템 경로가 없으므로,
    // 기본 lib 파일 경로를 우리가 복사해 둔 typescript-libs 쪽으로 직접 고정한다.
    getDefaultLibFileName: options => path.join(LIB_DIR, ts.getDefaultLibFileName(options)),
    fileExists: fileName => fileName === FILE_NAME || fs.existsSync(fileName),
    readFile: fileName => {
      if (fileName === FILE_NAME) return currentText;
      return fs.existsSync(fileName) ? fs.readFileSync(fileName, 'utf8') : undefined;
    },
    directoryExists: dirName => dirName === LIB_DIR || fs.existsSync(dirName),
    getDirectories: () => []
  };
}

const languageService = ts.createLanguageService(createHost(), ts.createDocumentRegistry());

const KIND_MAP: Record<string, CompletionItemKind> = {
  [ts.ScriptElementKind.functionElement]: CompletionItemKind.Function,
  [ts.ScriptElementKind.variableElement]: CompletionItemKind.Variable,
  [ts.ScriptElementKind.memberVariableElement]: CompletionItemKind.Field,
  [ts.ScriptElementKind.memberFunctionElement]: CompletionItemKind.Method,
  [ts.ScriptElementKind.keyword]: CompletionItemKind.Keyword,
  [ts.ScriptElementKind.classElement]: CompletionItemKind.Class,
  [ts.ScriptElementKind.interfaceElement]: CompletionItemKind.Interface
};

function syncText(regions: DocumentRegions): TextDocument {
  const embedded = regions.getEmbeddedDocument('javascript');
  currentText = embedded.getText();
  scriptVersion++;
  return embedded;
}

export function getJsCompletions(
  document: TextDocument,
  regions: DocumentRegions,
  position: Position
): CompletionList {
  const embedded = syncText(regions);
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
  const embedded = syncText(regions);
  const offset = embedded.offsetAt(position);

  const info = languageService.getQuickInfoAtPosition(FILE_NAME, offset);
  if (!info) return null;

  const text = ts.displayPartsToString(info.displayParts);
  return {
    contents: { kind: 'markdown', value: '```typescript\n' + text + '\n```' }
  };
}
