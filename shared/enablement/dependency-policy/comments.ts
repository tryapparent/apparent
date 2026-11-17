import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Parser, Language} from 'web-tree-sitter';
import {Parser as YamlParser, parseAllDocuments} from 'yaml';
import {git} from './snapshot.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const languages: Record<string, string> = {
  ts:'typescript', mts:'typescript', cts:'typescript', tsx:'tsx',
  js:'javascript', mjs:'javascript', cjs:'javascript', jsx:'javascript',
  rs:'rust', swift:'swift', py:'python', css:'css',
  sh:'bash', bash:'bash', yml:'yaml', yaml:'yaml', toml:'toml',
  c:'c', h:'c', m:'objc', mm:'cpp', html:'html', htm:'html',
  json:'json', jsonc:'json',
};
const fallback = new Set(['bash','toml','objc','html','json']);
const noncode = new Set(['md','txt','png','jpg','jpeg','gif','webp','ico','icns','ttf','woff','woff2','mp4','mp3','wav','pdf','lock']);
const cache = new Map<string, Language>();
let initialized = false;
export async function comments(file: string, text: string): Promise<string[]> {
  const ext = path.posix.extname(file).slice(1).toLowerCase();
  if (noncode.has(ext) || ['LICENSE','NOTICE'].includes(path.posix.basename(file))) return [];
  const firstLine = text.split('\n')[0];
  const shebang = /^#!.*\b(?:ba|da|z)?sh\b/.test(firstLine) ? 'bash'
    : /^#!.*\bpython(?:[23](?:\.\d+)?)?\b/.test(firstLine) ? 'python'
    : /^#!.*\bnode\b/.test(firstLine) ? 'javascript' : undefined;
  const language = languages[ext] ?? shebang;
  if (!language) throw new Error(`${file}: unsupported comment syntax; add a pinned syntax parser before editing this file`);
  if (language === 'yaml') {
    if (parseAllDocuments(text).some(doc => doc.errors.length)) throw new Error(`${file}: invalid YAML syntax`);
    const result: string[] = [];
    function visit(value: any) {
      if (!value || typeof value !== 'object') return;
      if (value.type === 'comment') result.push(value.source);
      else for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
    }
    for (const token of new YamlParser().parse(text)) visit(token);
    return result;
  }
  if (!initialized) {await Parser.init(); initialized = true;}
  if (!cache.has(language)) cache.set(language, await Language.load(path.join(here, 'node_modules', fallback.has(language) ? 'tree-sitter-wasms' : '@repomix/tree-sitter-wasms', 'out', `tree-sitter-${language}.wasm`)));
  const parser = new Parser();
  parser.setLanguage(cache.get(language)!);
  const tree = parser.parse(text);
  try {
    if (!tree || tree.rootNode.hasError) throw new Error(`${file}: syntax parser cannot safely classify comments; repair syntax or add supported grammar`);
    const result: string[] = [];
    function visit(node: any) {
      if (/(?:^|_)comment$/.test(node.type)) {
        if (!(node.startIndex === 0 && node.text.startsWith('#!'))) result.push(node.text.replace(/\r?\n$/, ''));
        return;
      }
      if (node.type === 'raw_text' && node.text.trim()) throw new Error(`${file}: embedded HTML code requires a dedicated parser; unsupported changed file`);
      for (const child of node.children) visit(child);
    }
    visit(tree.rootNode);
    return result;
  } finally {tree?.delete(); parser.delete();}
}
export async function checkComments(cwd: string, head: string | undefined, tree: string): Promise<string[]> {
  const before = new Map<string, string>();
  const after = new Map<string, string>();
  function entries(ref: string, output: Map<string, string>) {
    for (const row of git(['ls-tree','-rz',ref],cwd).split('\0').filter(Boolean)) {
      const tab = row.indexOf('\t');
      output.set(row.slice(tab+1),row.slice(0,tab));
    }
  }
  if (head) entries(head,before);
  entries(tree,after);
  const renames = new Map<string, string>();
  if (head) {
    const fields = git(['diff','--name-status','-z','--find-renames=50%',head,tree,'--'],cwd).split('\0');
    for (let i=0; i<fields.length && fields[i];) {
      const status=fields[i++], old=fields[i++];
      if (status.startsWith('R')) {const next=fields[i++]; if (!after.has(old) && !before.has(next)) renames.set(next,old);}
      else if (status.startsWith('C')) i++;
    }
  }
  const errors: string[] = [];
  for (const [file, meta] of after) {
    if (meta === before.get(file)) continue;
    const old = before.has(file) ? file : renames.get(file);
    try {
      if (!meta.startsWith('100')) throw new Error(`${file}: unsupported changed Git mode; comment rule requires regular files`);
      const text = git(['show',`${tree}:${file}`],cwd);
      const candidate = await comments(file,text);
      const baseline = old ? await comments(old,git(['show',`${head}:${old}`],cwd)) : [];
      const allowance = new Map<string,number>();
      for (const comment of baseline) allowance.set(comment,(allowance.get(comment) ?? 0)+1);
      for (const comment of candidate) {
        const count = allowance.get(comment) ?? 0;
        if (count) allowance.set(comment,count-1);
        else errors.push(`${file}: added/changed code comment ${JSON.stringify(comment.slice(0,120))}`);
      }
    } catch (error) {errors.push(error instanceof Error ? error.message : String(error));}
  }
  return errors;
}
