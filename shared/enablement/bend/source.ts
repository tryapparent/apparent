export const bendSource = /\.bend$/i;

export function bendComments(file: string, source: string): string[] {
  if (source.includes("\0")) throw new Error(`${file}: NUL in Bend source`);
  const comments: string[] = [];
  const code = source.split("");
  const hide = (start: number, end: number) => {
    for (let index = start; index < end; index++) {
      if (code[index] !== "\n") code[index] = " ";
    }
  };
  for (let index = 0; index < source.length; ) {
    const start = index;
    const token = source[index++];
    if (token === "#") {
      while (index < source.length && source[index] !== "\n") index++;
      comments.push(source.slice(start, index));
      hide(start, index);
    } else if (token === '"' || token === "'") {
      let characters = 0;
      while (index < source.length && source[index] !== token) {
        const character = source.codePointAt(index)!;
        if (source[index] === "\\") {
          index++;
          const unicode = /^u\{[0-9a-f]+\}/i.exec(
            source.slice(index, index + 11),
          );
          if (unicode) index += unicode[0].length;
          else if (index < source.length && "ntr0\\'\"".includes(source[index]))
            index++;
          else throw new Error(`${file}: invalid Bend literal escape`);
        } else {
          index += character > 0xffff ? 2 : 1;
        }
        characters++;
      }
      if (source[index] !== token || (token === "'" && characters !== 1))
        throw new Error(`${file}: malformed Bend literal`);
      hide(start, ++index);
    }
  }
  const outsideLiterals = code.join("");
  for (const line of outsideLiterals.split("\n")) {
    if (/^\s*import(?:\s|$)/.test(line) && line.trim() !== "import Base")
      throw new Error(`${file}: only the bundled Bend import Base is admitted`);
  }
  return comments;
}
