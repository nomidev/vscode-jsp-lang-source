import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as ts from 'typescript';
import {
  CompletionList,
  CompletionItemKind,
  Definition,
  Hover,
  Location,
  Position
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentRegions } from '../embeddedSupport';
import { findVueMemberOffset } from './vueHeuristics';
import { findPrototypeChainDefinition, getMemberAccessContext } from './prototypeHeuristics';

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

// <script src="..."> 값을 실제 디스크 파일 경로로 해석한다.
// - http(s):// , // 로 시작하는 외부 URL은 대상이 아니므로 무시
// - "/"로 시작하면 워크스페이스 루트 기준 절대경로로 간주해 각 루트에서 순서대로 탐색
// - 그 외에는 현재 문서 기준 상대경로로 해석
function resolveScriptPath(
  src: string,
  documentFsPath: string | null,
  workspaceRoots: string[]
): string | null {
  if (/^(https?:)?\/\//i.test(src)) return null;

  if (src.startsWith('/')) {
    for (const root of workspaceRoots) {
      const candidate = path.join(root, src);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  if (!documentFsPath) return null;
  const candidate = path.resolve(path.dirname(documentFsPath), src);
  return fs.existsSync(candidate) ? candidate : null;
}

// 주의: TS LanguageService는 getDefaultLibFileName을 호출한다고 해서 그 파일을
// 프로그램에 자동으로 포함시켜주지 않는다. getScriptFileNames() 목록에 직접
// 넣어줘야 Array/Object/String 같은 전역 타입이 실제로 로드된다.
// (이걸 빠뜨리면 모든 값이 타입 추론 없이 {}로 잡히고, 멤버 자동완성/설명이 비게 된다.)
const DEFAULT_LIB_PATH = path.join(LIB_DIR, ts.getDefaultLibFileName(COMPILER_OPTIONS));
const PROGRAM_LIB_FILES = [DEFAULT_LIB_PATH, DOM_LIB_PATH];

let currentText = '';
let scriptVersion = 0;
let currentImportedFiles: string[] = [];

// jsp.javascript.globalScopeFolders 설정으로 지정된 폴더에서 스캔된 .js 파일 목록.
// server.ts가 설정이 바뀌거나 파일이 추가/삭제될 때마다 setGlobalScopeFiles로 갱신해준다.
let globalScopeFiles: string[] = [];

export function setGlobalScopeFiles(files: string[]): void {
  globalScopeFiles = files;
}

function fileVersion(fileName: string): string {
  try {
    return String(fs.statSync(fileName).mtimeMs);
  } catch {
    return '0';
  }
}

// 문서 하나짜리 초경량 LanguageServiceHost.
// - 스크립트 파일: 매 요청 시 최신 텍스트로 갱신
// - <script src="...">로 참조된 외부 js 파일: 실제 디스크 경로 그대로 프로그램에 포함 (mtime으로 변경 감지)
// - lib 파일: 실제 typescript-libs 디렉토리에서 그대로 읽어온다 (ts.sys에 의존하지 않음 -> 번들 후에도 안전)
function createHost(): ts.LanguageServiceHost {
  return {
    getScriptFileNames: () => [
      ...new Set([FILE_NAME, ...PROGRAM_LIB_FILES, ...currentImportedFiles, ...globalScopeFiles])
    ],
    getScriptVersion: fileName => (fileName === FILE_NAME ? String(scriptVersion) : fileVersion(fileName)),
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

function syncText(
  document: TextDocument,
  regions: DocumentRegions,
  workspaceRoots: string[]
): TextDocument {
  const embedded = regions.getEmbeddedDocument('javascript');
  currentText = embedded.getText();
  scriptVersion++;

  let documentFsPath: string | null = null;
  try {
    documentFsPath = fileURLToPath(document.uri);
  } catch {
    documentFsPath = null;
  }

  currentImportedFiles = regions
    .getImportedScripts()
    .map(src => resolveScriptPath(src, documentFsPath, workspaceRoots))
    .filter((p): p is string => p !== null);

  return embedded;
}

export function getJsCompletions(
  document: TextDocument,
  regions: DocumentRegions,
  position: Position,
  workspaceRoots: string[]
): CompletionList {
  const embedded = syncText(document, regions, workspaceRoots);
  const offset = embedded.offsetAt(position);

  const completions = languageService.getCompletionsAtPosition(FILE_NAME, offset, {});
  if (!completions) return { isIncomplete: false, items: [] };

  return {
    isIncomplete: false,
    items: completions.entries.map(entry => ({
      label: entry.name,
      kind: KIND_MAP[entry.kind] ?? CompletionItemKind.Text,
      sortText: entry.sortText
    }))
  };
}

export function getJsHover(
  document: TextDocument,
  regions: DocumentRegions,
  position: Position,
  workspaceRoots: string[]
): Hover | null {
  const embedded = syncText(document, regions, workspaceRoots);
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

// lib.*.d.ts 처럼 우리 문서가 아닌 파일의 오프셋 -> 위치 변환용 (읽기 캐시)
const libDocCache = new Map<string, TextDocument>();
function getLibDocument(fileName: string): TextDocument | null {
  let doc = libDocCache.get(fileName);
  if (doc) return doc;
  if (!fs.existsSync(fileName)) return null;
  const content = fs.readFileSync(fileName, 'utf8');
  doc = TextDocument.create(pathToFileURL(fileName).toString(), 'typescript', 1, content);
  libDocCache.set(fileName, doc);
  return doc;
}

// offset이 속한 식별자(identifier) 전체 텍스트를 뽑아낸다 (Vue 휴리스틱 폴백용)
function getIdentifierAt(text: string, offset: number): string | null {
  const isIdentChar = (ch: string) => /[\w$]/.test(ch);
  let start = offset;
  while (start > 0 && isIdentChar(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && isIdentChar(text[end])) end++;
  if (start === end) return null;
  return text.slice(start, end);
}

export function getJsDefinition(
  document: TextDocument,
  regions: DocumentRegions,
  position: Position,
  workspaceRoots: string[]
): Definition | null {
  const embedded = syncText(document, regions, workspaceRoots);
  const offset = embedded.offsetAt(position);

  const defs = languageService.getDefinitionAtPosition(FILE_NAME, offset);
  if (!defs || defs.length === 0) {
    // TS가 못 찾은 경우 1: base.member / this.member 형태면 ES5 프로토타입 상속
    // 체인(Object.create, new Parent() 등)을 따라가며 부모 프로토타입 멤버를 찾아본다
    // (base가 있으므로 Vue 휴리스틱보다 더 정밀함 - 먼저 시도)
    const memberCtx = getMemberAccessContext(currentText, offset);
    if (memberCtx) {
      const memberName = currentText.slice(memberCtx.memberStart, memberCtx.memberEnd);
      const found = findPrototypeChainDefinition(currentText, memberCtx.base, memberName, offset);
      if (found) {
        return [
          {
            uri: document.uri,
            range: {
              start: document.positionAt(found.start),
              end: document.positionAt(found.end)
            }
          }
        ];
      }
    }

    // TS가 못 찾은 경우 2: Vue methods/computed/data 안의 동일 이름 속성으로 시도
    // (methods: { foo(){} } 같은 객체 속성은 템플릿의 @click="foo"와 정적으로 연결되지 않으므로)
    const name = getIdentifierAt(currentText, offset);
    if (name) {
      const found = findVueMemberOffset(currentText, name);
      if (found) {
        return [
          {
            uri: document.uri,
            range: {
              start: document.positionAt(found.start),
              end: document.positionAt(found.end)
            }
          }
        ];
      }
    }

    return null;
  }

  const locations: Location[] = [];
  for (const def of defs) {
    if (def.fileName === FILE_NAME) {
      // 같은 <script> 블록 안의 정의: 임베디드 문서 오프셋이 원본 JSP 문서와
      // 완전히 동일하므로(마스킹은 길이를 바꾸지 않음) 그대로 매핑된다.
      locations.push({
        uri: document.uri,
        range: {
          start: document.positionAt(def.textSpan.start),
          end: document.positionAt(def.textSpan.start + def.textSpan.length)
        }
      });
      continue;
    }

    // typescript-libs 안의 내장 정의 (예: Array.prototype.push) - 확장에 실제로
    // 포함된 lib .d.ts 파일이므로 file:// 링크로 그대로 열어볼 수 있다.
    const libDoc = getLibDocument(def.fileName);
    if (!libDoc) continue;
    locations.push({
      uri: pathToFileURL(def.fileName).toString(),
      range: {
        start: libDoc.positionAt(def.textSpan.start),
        end: libDoc.positionAt(def.textSpan.start + def.textSpan.length)
      }
    });
  }

  return locations.length > 0 ? locations : null;
}
