/** Static inspection only: never evaluate tool arguments or historical commands. */
import { wholeShellOperation } from "./shell/launch-shapes.ts";
type Token = {value: string; literal?: boolean; dynamic?: boolean};
type ShellWord = {value: string; dynamic?: boolean};

function tokens(source: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (/\s/.test(c)) {i++; continue;}
    if (source.startsWith('//', i)) {const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; continue;}
    if (source.startsWith('/*', i)) {const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue;}
    if ('"\'`'.includes(c)) {
      const quote = c; let value = '', dynamic = false; i++;
      while (i < source.length && source[i] !== quote) {
        if (quote === '`' && source.startsWith('${', i)) dynamic = true;
        if (source[i] === '\\') {
          i++; const e = source[i++];
          if (e === 'u' || e === 'x') {
            const size = e === 'u' ? 4 : 2, hex = source.slice(i, i + size);
            if (new RegExp(`^[a-fA-F0-9]{${size}}$`).test(hex)) {value += String.fromCharCode(parseInt(hex, 16)); i += size;}
            else dynamic = true;
          } else value += ({n:'\n',r:'\r',t:'\t','\n':''} as Record<string,string>)[e] ?? e ?? '';
        } else value += source[i++];
      }
      if (source[i] !== quote) dynamic = true; else i++;
      out.push({value, literal: true, dynamic}); continue;
    }
    const word = source.slice(i).match(/^[\w$]+/);
    if (word) {out.push({value: word[0]}); i += word[0].length;}
    else {out.push({value:c}); i++;}
  }
  return out;
}

function toolOperation(name: string): string {
  if (/write_stdin|(?:^|[._])(wait|sleep)$|thread_wait|wait_agent/.test(name)) return 'process wait';
  if (/apply_patch/.test(name)) return 'source/artifact editing';
  if (/delegate_task|spawn_agent/.test(name)) return 'delegated work/review';
  if (/thread_read|thread_list/.test(name)) return 'thread context inspection';
  if (/thread_send|send_message|followup_task/.test(name)) return 'agent coordination';
  if (/update_plan|goal/.test(name)) return 'planning/bookkeeping';
  if (/view_image|preview|screenshot|html_render|html_preview/.test(name)) return 'visual inspection/render';
  if (/pull_request/.test(name)) return 'CI/PR operations';
  if (/web|search_query|search_service/.test(name)) return 'research/search';
  if (/clock|curr_time/.test(name)) return 'clock inspection';
  return 'unknown';
}

type Heredoc = {delimiter: string; quoted: boolean; stripTabs: boolean};

function heredocEnd(source: string, start: number, {delimiter, quoted, stripTabs}: Heredoc): number {
  for (let i = start; i < source.length;) {
    const newline = source.indexOf('\n', i);
    const end = newline === -1 ? source.length : newline;
    const line = source.slice(i, end);
    if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) return end;
    if (!quoted && /\$\(|`|\\$/.test(line)) return -1;
    i = end + 1;
  }
  return -1;
}

function commandOperation(words: ShellWord[]): string {
  if (words[0]?.value === 'taskset') {
    const [, option, affinity, executable, verb, remote, ref] = words.map(word => word.value);
    return words.length === 7 &&
      !words.some(word => word.dynamic) &&
      option === '-c' && /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(affinity) &&
      executable === 'git' && verb === 'push' && remote === 'origin' && ref === 'HEAD'
      ? 'verification/push' : 'unknown';
  }
  while (words.length && /^(?:\w+=|(?:env|sudo|command|exec|timeout|\d+[smh]?)$)/.test(words[0].value)) words = words.slice(1);
  const [command, ...args] = words;
  const name = command?.value.split('/').pop() ?? '';
  if (!name || /^(then|do|done|fi|else|true|false|set|export|umask)$/.test(name)) return 'shell control';
  if (name === 'git') {
    let index = 0;
    while (args[index]?.value === '-c') {
      const setting = args[index + 1];
      if (args[index].dynamic || setting?.dynamic ||
          !/^[a-z0-9-]+\.(?:[^\0\r\n=]*\.)?[a-z][a-z0-9-]*=/i.test(setting?.value ?? '')) return 'unknown';
      index += 2;
    }
    const {value: verb = '', dynamic} = args[index] ?? {};
    if (index && (dynamic || !/^[a-z][a-z0-9-]*$/.test(verb))) return 'unknown';
    if (verb === 'push') return 'verification/push';
    if (/^(commit|merge|rebase|cherry-pick|switch|checkout|add|restore|reset)$/.test(verb)) return 'Git integration/editing';
    return 'Git inspection';
  }
  if (name === 'gh') return args[0]?.value === 'run' && args[1]?.value === 'watch' ? 'CI observation' : 'CI/PR operations';
  if (name === 'cargo') return 'Rust build/test';
  if (name === 't3-build') return 'build/test runner';
  if (/^(node|bun|npm|npx|pnpm|yarn|python3?|bash|sh)$/.test(name)) {
    const values = args.map(({value}) => value);
    if (values.some(a => /local-tests\/execution\/push\.[cm]?ts$|pre-push/.test(a))) return 'verification/push';
    if (values.some(a => /gh_owned_wait|main-watch/.test(a))) return 'CI observation';
    if (values.some(a => /verification\.py$/.test(a)) && values.includes('--run')) return 'verification/push';
    if (values.some(a => /^(test|build|ci|install|--test)$/.test(a))) return 'JavaScript/package build/test';
    return 'script execution (purpose unresolved)';
  }
  if (/^(rg|grep|sed|cat|head|tail|cut|sort|uniq|awk|less|jq|wc|find|ls|stat|du|readlink|sha256sum|shasum|file|which|pwd)$/.test(name)) return 'source/artifact inspection';
  if (/^(cp|mv|mkdir|mktemp|rm|rmdir|chmod|touch|tee|printf|echo)$/.test(name)) return 'file/artifact management';
  if (/^(ssh|scp|rsync)$/.test(name)) return 'remote execution/transfer';
  if (/^(curl|wget)$/.test(name)) return 'network fetch';
  if (/^(ps|pgrep|uptime|free|df|vmstat|sar|iostat|systemctl|nproc)$/.test(name)) return 'host/process diagnostics';
  if (/^(date|sleep)$/.test(name)) return name === 'sleep' ? 'process wait' : 'clock inspection';
  return 'unknown';
}

export function shellOperations(source: string): string[] {
  const whole = wholeShellOperation(source);
  if (whole) return [whole];
  const pending: Heredoc[] = [];
  const commands: {words:ShellWord[]; write:boolean}[] = [];
  const prelude = /[ \t]*(?:[A-Za-z_]\w*=\$\((mktemp) -d \/tmp\/apparent-dev-[A-Za-z0-9][\w-]*-XXXXXX\)|test "\$\(git rev-parse origin\/main\)" = "\$\(git rev-parse HEAD\^\)"|test -z "\$\(git status --porcelain\)")[ \t]*(?=\n|$)/y;
  let words: ShellWord[] = [], word = '', quote = '', write = false;
  let dynamic = false, quoted = false;
  const flushWord = () => {
    if (word || quoted) words.push({value: word, dynamic});
    word = '';
    dynamic = false;
    quoted = false;
  };
  const flush = () => {flushWord(); if (words.length) commands.push({words,write}); words = []; write = false;};
  for (let i = 0; i < source.length; i++) {
    if (!quote && !word && !quoted && !words.length && (i === 0 || source[i - 1] === '\n')) {
      prelude.lastIndex = i;
      const match = prelude.exec(source);
      if (match) {
        commands.push({words: [{value: match[1] ?? 'git'}], write: false});
        i = prelude.lastIndex - 1;
        continue;
      }
    }
    const c = source[i];
    if (c === '\\' && quote !== "'") {
      const escaped = source[++i];
      if (escaped === undefined || escaped === '\n' || (quote === '"' && !'$`"\\'.includes(escaped))) dynamic = true;
      word += escaped ?? '';
      continue;
    }
    if (quote !== "'" && (c === '`' || (c === '$' && /^\$(?:\\\n)*\(/.test(source.slice(i))))) return ['unknown'];
    if ((c === '$' && quote !== "'") || (!quote && '*?[{}~()'.includes(c))) dynamic = true;
    if (quote) {if (c === quote) quote = ''; else word += c; continue;}
    if (c === '"' || c === "'") {quote = c; quoted = true; continue;}
    if (c === '#' && !word && !quoted) {while (i + 1 < source.length && source[i + 1] !== '\n') i++; continue;}
    if (c === '\n' && pending.length) {
      flush();
      for (const heredoc of pending) {
        i = heredocEnd(source, i + 1, heredoc);
        if (i < 0) return ['unknown'];
      }
      pending.length = 0;
      continue;
    }
    if (c === '>' || c === '<') {
      if (c === '>') write = true;
      if (/^\d+$/.test(word) && !quoted) word = ''; else flushWord();
      if (source.startsWith('<<', i) && !source.startsWith('<<<', i)) {
        const header = source.slice(i).match(/^<<(-?)[ \t]*(['"]?)([\w-]+)\2(?=[ \t\n;|&<>]|$)/);
        if (!header) return ['unknown'];
        pending.push({delimiter: header[3], quoted: !!header[2], stripTabs: !!header[1]});
        i += header[0].length - 1;
        continue;
      }
      const redirection = source.slice(i).match(/^[<>]+-?[ \t]*(&\d+|"(?:\\[^\n]|[^"\\\n])*"|'[^'\n]*'|[^\s;&|'"]+)?/);
      if (redirection) {
        const target = redirection[1] ?? '';
        if (source[i + 1] === '(' || /['"]/.test(source[i + redirection[0].length] ?? '') ||
            (!/^'[^']*'$/.test(target) && /\$\(|`|[<>]\(|\\$/.test(target))) return ['unknown'];
        i += redirection[0].length - 1;
        continue;
      }
    }
    if (';|&\n'.includes(c)) {flush(); continue;}
    if (/\s/.test(c)) flushWord(); else word += c;
  }
  flush();
  if (quote || pending.length) return ['unknown'];
  return commands.map(({words,write}) => write && /^(cat|printf|echo)$/.test(words[0].value) ? 'file/artifact management' : commandOperation(words));
}

export function operations(tool: string, source: string): {operations:string[]; batched:boolean} {
  let direct: any;
  try {direct = JSON.parse(source);} catch { /* Custom exec wrappers are code, not JSON. */ }
  if (/exec_command|shell|execute/.test(tool) && typeof direct?.cmd === 'string') return finish(shellOperations(direct.cmd), false);
  if (!/^(exec|functions\.exec)$/.test(tool)) return finish([toolOperation(tool)], false);
  const ts = tokens(source), found: string[] = []; let commands = 0, nested = 0;
  for (let i = 0; i + 3 < ts.length; i++) {
    if (ts[i].literal || ts[i].value !== 'tools' || ts[i+1].value !== '.' || ts[i+2].literal || ts[i+3].value !== '(') continue;
    nested++; const name = ts[i+2].value;
    if (!/exec_command|shell|execute/.test(name)) {found.push(toolOperation(name)); continue;}
    commands++; let depth = 0, matched = false;
    for (let j = i + 4; j < ts.length; j++) {
      const t = ts[j];
      if (!t.literal && ['{','[','('].includes(t.value)) depth++;
      if (!t.literal && ['}',']',')'].includes(t.value)) {if (!depth) break; depth--;}
      if (depth === 1 && t.value === 'cmd' && ts[j+1]?.value === ':') {
        const value = ts[j+2], after = ts[j+3]; matched = true;
        if (value?.literal && !value.dynamic && [',','}'].includes(after?.value)) found.push(...shellOperations(value.value));
        else found.push('unknown');
      }
    }
    if (!matched) found.push('unknown');
  }
  return finish(nested ? found : shellOperations(source), commands > 1);
}

function finish(values:string[], batched:boolean) {
  const meaningful = values.filter(v => v !== 'shell control');
  return {operations:[...new Set(meaningful.length ? meaningful : ['unknown'])].sort(), batched};
}

export const unresolvedOperation = (s: string) => s === 'unknown' || s === 'process wait' || s.includes('unresolved');

/** Name coherent workflow envelopes without splitting their unmeasured nested phases. */
export function operationFamily(values:string[]): string[] {
  if (values.length < 2 || values.some(v=>v === 'unknown' || v.includes('unresolved'))) return values;
  const preparation = ['Git inspection','Git integration/editing','file/artifact management','source/artifact inspection','source/artifact editing','planning/bookkeeping'];
  const execution = values.filter(v=>!preparation.includes(v));
  if (execution.length === 1 && ['verification/push','Rust build/test','build/test runner','JavaScript/package build/test'].includes(execution[0])) return [execution[0]+' with preparation'];
  if (execution.length === 1 && execution[0] === 'process wait') return ['process wait with status inspection (underlying work unresolved)'];
  if (!execution.length) {
    if (values.includes('source/artifact editing')) return ['source/artifact editing with inspection'];
    if (values.includes('file/artifact management')) return ['artifact preparation with inspection'];
    return ['source/Git context inspection'];
  }
  return values;
}
