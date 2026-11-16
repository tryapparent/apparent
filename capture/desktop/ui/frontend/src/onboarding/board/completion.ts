// Only native-acknowledged, completed human strokes count. Drafts and the
// animated example never advance practice. One stroke can be closed manually.
export function shouldClosePracticeBoard(strokes: readonly (readonly unknown[])[]): boolean {
  return strokes.filter(stroke=>stroke.length>0).length>=2;
}
