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

// jsp.javascript.globalScopeFolders 설정에 지정된 폴더들을 스캔해서
// <script src> 연결 여부와 무관하게 항상 JS 언어 서비스 전역 스코프에 포함시킬
// .js 파일 목록을 관리한다. (IntelliJ/WebStorm의 "전역 리졸브 스코프"와 유사한 방식)
export class GlobalScopeIndex {
  private files: string[] = [];

  getFiles(): string[] {
    return this.files;
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
        const start = path.join(root, rel);
        if (fs.existsSync(start)) {
          existedInAnyRoot = true;
          await this.walk(start, 0, found);
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
