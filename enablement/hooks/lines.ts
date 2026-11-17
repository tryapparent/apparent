import {execFileSync} from 'node:child_process';

try {
  const git = (...args: string[]) => execFileSync('git',args,{maxBuffer:128*1024*1024});
  const records = git('diff','--cached','--raw','-z','--no-abbrev','--no-renames','--diff-filter=AM').toString('utf8').split('\0');
  const violations: string[] = [];
  for (let i=0;i<records.length-1;i+=2) {
    const [,mode,,blob] = records[i].split(' ');
    const file = records[i+1];
    if (!['100644','100755'].includes(mode) || file === 'Cargo.lock') continue;
    const content=git('cat-file','blob',blob);
    if (content.subarray(0,8000).includes(0)) continue;
    let lines=0;
    for (const byte of content) if (byte === 10) lines++;
    if (content.length && content[content.length-1] !== 10) lines++;
    if (lines>2000) violations.push(`${JSON.stringify(file)}: ${lines} lines`);
  }
  if (violations.length) {
    console.error('pre-commit: text files must contain at most 2000 lines (including comments and blank lines).\n'+violations.join('\n'));
    process.exitCode=1;
  }
} catch(error) {
  console.error('pre-commit: could not check staged line limits:',error instanceof Error ? error.message : error);
  process.exitCode=1;
}
