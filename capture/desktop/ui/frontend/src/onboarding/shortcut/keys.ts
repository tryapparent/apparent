export function recordKeys(shortcut: string): string[] {
  const mac = shortcut.match(/^([⌃⌥⇧⌘]+)(.+)$/u);
  if (mac) return [...Array.from(mac[1]), mac[2]];
  const modifiers: string[] = [];
  let key = shortcut.trim(), match;
  while ((match = key.match(/^(Ctrl|Control|Alt|Option|Shift|Super|Meta|Command|Cmd)\s*\+\s*/i))) {
    modifiers.push(match[1]);
    key = key.slice(match[0].length);
  }
  // After modifier separators, the remaining '+' is a literal key.
  return modifiers.length && key ? [...modifiers, key] : [shortcut];
}
