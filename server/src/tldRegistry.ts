import * as fs from 'fs';
import * as path from 'path';

export interface TldAttribute {
  name: string;
  required: boolean;
  rtexprvalue: boolean;
  description?: string;
}

export interface TldTag {
  name: string;
  description?: string;
  attributes: TldAttribute[];
}

export interface TldInfo {
  uri?: string;
  shortName?: string;
  filePath: string;
  tags: TldTag[];
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'build', 'out', 'dist', '.idea']);
const MAX_DEPTH = 15;

function firstMatch(text: string, regex: RegExp): string | undefined {
  const m = regex.exec(text);
  return m ? m[1].trim() : undefined;
}

// 태그 블록 안에서 <attribute>...</attribute>를 먼저 떼어내야
// 태그 자신의 <name>과 속성의 <name>이 섞이지 않는다.
function parseTag(tagBlock: string): TldTag | null {
  const attributeBlocks: string[] = [];
  const withoutAttributes = tagBlock.replace(
    /<attribute>([\s\S]*?)<\/attribute>/g,
    (_match, inner: string) => {
      attributeBlocks.push(inner);
      return '';
    }
  );

  const name = firstMatch(withoutAttributes, /<name>\s*([^<]+?)\s*<\/name>/);
  if (!name) return null;

  const description = firstMatch(withoutAttributes, /<description>\s*([\s\S]*?)\s*<\/description>/);

  const attributes: TldAttribute[] = attributeBlocks
    .map((block): TldAttribute | null => {
      const attrName = firstMatch(block, /<name>\s*([^<]+?)\s*<\/name>/);
      if (!attrName) return null;
      return {
        name: attrName,
        required: /<required>\s*true\s*<\/required>/i.test(block),
        rtexprvalue: /<rtexprvalue>\s*true\s*<\/rtexprvalue>/i.test(block),
        description: firstMatch(block, /<description>\s*([\s\S]*?)\s*<\/description>/)
      };
    })
    .filter((a): a is TldAttribute => a !== null);

  return { name, description, attributes };
}

// 정식 XML 파서가 아닌, TLD의 일반적인 구조(중첩 없는 <tag>/<attribute>)에 맞춘
// 가벼운 정규식 기반 파서. 대부분의 실무 TLD 파일 형태를 커버한다.
export function parseTld(content: string, filePath: string): TldInfo {
  const uri = firstMatch(content, /<uri>\s*([^<]+?)\s*<\/uri>/);
  const shortName = firstMatch(content, /<short-name>\s*([^<]+?)\s*<\/short-name>/);

  const tags: TldTag[] = [];
  const tagRegex = /<tag>([\s\S]*?)<\/tag>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(content))) {
    const tag = parseTag(m[1]);
    if (tag) tags.push(tag);
  }

  return { uri, shortName, filePath, tags };
}

export class TldRegistry {
  private byUri = new Map<string, TldInfo>();
  private byPath = new Map<string, TldInfo>();

  getByUri(uri: string): TldInfo | undefined {
    return this.byUri.get(uri);
  }

  getAll(): TldInfo[] {
    return [...this.byPath.values()];
  }

  async scanWorkspace(roots: string[]): Promise<void> {
    this.byUri.clear();
    this.byPath.clear();
    for (const root of roots) {
      await this.walk(root, 0);
    }
  }

  private async walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.tld')) {
        await this.loadFile(full);
      }
    }
  }

  async loadFile(filePath: string): Promise<void> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      const info = parseTld(content, filePath);
      this.byPath.set(filePath, info);
      if (info.uri) this.byUri.set(info.uri, info);
    } catch {
      // 개별 tld 파싱 실패가 전체 기능을 막지 않도록 조용히 무시
    }
  }

  removeFile(filePath: string): void {
    const info = this.byPath.get(filePath);
    if (info?.uri) this.byUri.delete(info.uri);
    this.byPath.delete(filePath);
  }
}
