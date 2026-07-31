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

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  allowJs: true,
  checkJs: false,
  module: ts.ModuleKind.ESNext
};

// 주의: TS LanguageService는 getDefaultLibFileName을 호출한다고 해서 그 파일을
// 프로그램에 자동으로 포함시켜주지 않는다. getScriptFileNames() 목록에 직접
// 넣어줘야 Array/Object/String 같은 전역 타입이 실제로 로드된다.
// (이걸 빠뜨리면 모든 값이 타입 추론 없이 {}로 잡히고, 멤버 자동완성/설명이 비게 된다.)
const DEFAULT_LIB_PATH = path.join(LIB_DIR, ts.getDefaultLibFileName(COMPILER_OPTIONS));
const PROGRAM_LIB_FILES = [DEFAULT_LIB_PATH, DOM_LIB_PATH];

let currentText = '';
let scriptVersion = 0;

// 문서 하나짜리 초경량 LanguageServiceHost.
// - 스크립트 파일: 매 요청 시 최신 텍스트로 갱신
// - lib 파일: 실제 typescript-libs 디렉토리에서 그대로 읽어온다 (ts.sys에 의존하지 않음 -> 번들 후에도 안전)
function createHost(): ts.LanguageServiceHost {
  return {
    getScriptFileNames: () => [FILE_NAME, ...PROGRAM_LIB_FILES],
    getScriptVersion: fileName => (fileName === FILE_NAME ? String(scriptVersion) : '1'),
    getScriptSnapshot: fileName => {
      if (fileName === FILE_NAME) return ts.ScriptSnapshot.fromString(currentText);
      if (fs.existsSync(fileName)) return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
      return undefined;
    },
    getCurrentDirectory: () => '',
    getCompilationSettings: () => COMPILER_OPTIONS,
    getDefaultLibFileName: () => DEFAULT_LIB_PATH,
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

  const signature = ts.displayPartsToString(info.displayParts);
  const documentation = ts.displayPartsToString(info.documentation);
  const tags = (info.tags ?? [])
    .map(tag => `*@${tag.name}* ${tag.text ? ts.displayPartsToString(tag.text) : ''}`)
    .join('\n\n');

  const parts = ['```typescript', signature, '```'];
  if (documentation) parts.push('', documentation);
  if (tags) parts.push('', tags);

  return {
    contents: { kind: 'markdown', value: parts.join('\n') }
  };
}
