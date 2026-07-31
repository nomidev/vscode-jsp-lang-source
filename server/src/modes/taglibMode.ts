import { CompletionItem, CompletionItemKind, CompletionList, InsertTextFormat } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TldRegistry } from '../tldRegistry';

type TagContext =
  | { type: 'tag-name'; prefix: string }
  | { type: 'attribute'; prefix: string; tagName: string };

// 현재 파일에 선언된 <%@ taglib prefix="x" uri="y" %> 를 모두 모아 prefix -> uri 매핑을 만든다.
function getTaglibPrefixMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const directiveRegex = /<%@\s*taglib\b([^%]*)%>/g;
  let m: RegExpExecArray | null;
  while ((m = directiveRegex.exec(text))) {
    const attrs = m[1];
    const prefix =
      /\bprefix\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ?? /\bprefix\s*=\s*'([^']+)'/.exec(attrs)?.[1];
    const uri = /\buri\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ?? /\buri\s*=\s*'([^']+)'/.exec(attrs)?.[1];
    if (prefix && uri) map.set(prefix, uri);
  }
  return map;
}

// 커서 바로 앞 텍스트만 보고 "<prefix:부분입력" (태그명 자리)인지,
// "<prefix:tagName ...(닫히지 않음)" (속성 자리)인지 판별한다.
function detectTagContext(text: string, offset: number): TagContext | null {
  const before = text.slice(Math.max(0, offset - 500), offset);

  const tagNameMatch = /<([A-Za-z_][\w-]*):([\w-]*)$/.exec(before);
  if (tagNameMatch) {
    return { type: 'tag-name', prefix: tagNameMatch[1] };
  }

  const lastOpen = before.lastIndexOf('<');
  if (lastOpen === -1) return null;
  const tail = before.slice(lastOpen);
  // 마지막으로 연 태그가 아직 '>'로 닫히지 않았고 prefix:tagName 형태라면 속성 입력 위치
  const attrCtxMatch = /^<([A-Za-z_][\w-]*):([\w-]+)(?:\s[^>]*)?$/.exec(tail);
  if (attrCtxMatch && !tail.includes('>')) {
    return { type: 'attribute', prefix: attrCtxMatch[1], tagName: attrCtxMatch[2] };
  }

  return null;
}

export function getTaglibCompletions(
  document: TextDocument,
  registry: TldRegistry,
  offset: number
): CompletionList | null {
  const text = document.getText();
  const ctx = detectTagContext(text, offset);
  if (!ctx) return null;

  const prefixMap = getTaglibPrefixMap(text);
  const uri = prefixMap.get(ctx.prefix);
  if (!uri) return null;

  const tld = registry.getByUri(uri);
  if (!tld) return null;

  if (ctx.type === 'tag-name') {
    const items: CompletionItem[] = tld.tags.map(tag => ({
      label: tag.name,
      kind: CompletionItemKind.Property,
      detail: tld.shortName ?? tld.uri,
      documentation: tag.description
    }));
    return { isIncomplete: false, items };
  }

  const tag = tld.tags.find(t => t.name === ctx.tagName);
  if (!tag) return { isIncomplete: false, items: [] };

  const items: CompletionItem[] = tag.attributes.map(attr => ({
    label: attr.name,
    kind: CompletionItemKind.Field,
    detail: attr.required ? '필수' : undefined,
    documentation: attr.description,
    insertText: `${attr.name}="$1"`,
    insertTextFormat: InsertTextFormat.Snippet
  }));
  return { isIncomplete: false, items };
}

// <%@ taglib %> 지시어 안에서 uri/prefix 자동완성을 위해, 워크스페이스에서 발견한 tld 목록을 제공.
export function getDiscoveredTaglibSuggestions(
  registry: TldRegistry
): { prefix: string; uri: string }[] {
  return registry
    .getAll()
    .filter(t => t.uri)
    .map(t => ({ prefix: t.shortName ?? 'tag', uri: t.uri! }));
}
