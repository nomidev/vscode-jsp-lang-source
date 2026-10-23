import * as fs from 'fs';
import * as path from 'path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'build', 'out', 'dist', '.idea']);
const MAX_DEPTH = 15;
const MAX_FILES = 2000; // 폭주 방지용 상한

export interface ScanResult {
  /** 발견된 .js 파일 절대경로 목록 */
  files: string[];
  /** 워크스페이스 루트 어디에서도 실제로 존재하지 않았던 설정값들 (사용자에게 경고하기 위함) */
  missingFolders: string[];
}

// "LGCOM/src/..." 처럼 상대경로의 첫 조각과, 그 뒤 나머지를 분리한다.
// (구분자가 '/'든 '\'든 상관없이 동작하도록 정규화)
function splitFirstSegment(relPath: string): { first: string; rest: string } | null {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const idx = normalized.indexOf('/');
  if (idx === -1) return null;
  return { first: normalized.slice(0, idx), rest: normalized.slice(idx + 1) };
}

// (root, rel) 하나에 대해 실제로 시도해볼 후보 절대경로들을 우선순위대로 반환한다.
//
// 멀티루트 워크스페이스(예: 워크스페이스 루트가 .../LGCOM, .../LGFIN, .../LGICM 각각)에서는
// 설정값을 "LGCOM/src/main/webapp/static/js"처럼 모듈 이름을 접두어로 써서 특정 루트를
// 가리키도록 작성하는 경우가 흔하다. 이때 그냥 root + rel 로 이어붙이면
// ".../LGCOM/LGCOM/src/..." 처럼 모듈명이 중복돼서 못 찾는다.
// rel의 첫 조각이 root 폴더 이름과 같으면, 그 조각을 뗀 나머지를 그 root에 이어붙인
// 경로도 함께 시도한다.
function resolveCandidates(root: string, rel: string): string[] {
  const candidates: string[] = [];
  const split = splitFirstSegment(rel);
  if (split && split.first.toLowerCase() === path.basename(root).toLowerCase()) {
    candidates.push(path.join(root, split.rest));
  }
  candidates.push(path.join(root, rel));
  return candidates;
}

// 경로 비교용 정규화 (구분자/대소문자 차이 무시). Windows 에서는 대소문자를 구분하지 않고,
// 그 외 환경에서 생길 수 있는 오탐은 재스캔이 한 번 더 도는 정도라 무해하다.
function normalizeForCompare(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

// jsp.javascript.globalScopeFolders 설정에 지정된 폴더들을 스캔해서
// <script src> 연결 여부와 무관하게 항상 JS 언어 서비스 전역 스코프에 포함시킬
// .js 파일 목록을 관리한다. (IntelliJ/WebStorm의 "전역 리졸브 스코프"와 유사한 방식)
export class GlobalScopeIndex {
  private files: string[] = [];

  getFiles(): string[] {
    return this.files;
  }

  /**
   * 변경된 파일이 jsp.javascript.globalScopeFolders 로 지정한 폴더 안에 있는지 확인한다.
   * 파일 변경 알림이 올 때 "전역 스코프 목록을 다시 만들어야 하는 변경인지" 거르는 용도이며,
   * 폴더가 아직 없어도(나중에 생길 수도 있으므로) 설정값만으로 판단한다.
   */
  isInsideConfiguredFolders(filePath: string, workspaceRoots: string[], relativeFolders: string[]): boolean {
    if (relativeFolders.length === 0) return false;
    const target = normalizeForCompare(filePath);
    for (const root of workspaceRoots) {
      for (const rel of relativeFolders) {
        for (const candidate of resolveCandidates(root, rel)) {
          const dir = normalizeForCompare(candidate);
          if (target === dir || target.startsWith(dir + '/')) return true;
        }
      }
    }
    return false;
  }

  async scan(workspaceRoots: string[], relativeFolders: string[]): Promise<ScanResult> {
    if (relativeFolders.length === 0) {
      this.files = [];
      return { files: [], missingFolders: [] };
    }

    const found: string[] = [];
    const missingFolders: string[] = [];

    for (const rel of relativeFolders) {
      let existedInAnyRoot = false;
      for (const root of workspaceRoots) {
        for (const candidate of resolveCandidates(root, rel)) {
          if (fs.existsSync(candidate)) {
            existedInAnyRoot = true;
            await this.walk(candidate, 0, found);
            break; // 이 root에서는 첫 매칭 후보만 사용 (같은 폴더 중복 스캔 방지)
          }
        }
      }
      if (!existedInAnyRoot) missingFolders.push(rel);
    }

    this.files = found.slice(0, MAX_FILES);
    return { files: this.files, missingFolders };
  }

  private async walk(dir: string, depth: number, out: string[]): Promise<void> {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // 존재하지 않는 폴더는 조용히 무시
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(full, depth + 1, out);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.js')) {
        out.push(full);
      }
    }
  }
}
