export const guideRoutes = [
  ['guides/record-screen-for-coding-agent/index.html', '/guides/record-screen-for-coding-agent/'],
  ['guides/send-existing-screen-recording/index.html', '/guides/send-existing-screen-recording/'],
  ['guides/show-coding-agent-right-ui-element/index.html', '/guides/show-coding-agent-right-ui-element/'],
] as const

export const agentRoutes = [
  ['agents/index.html', '/agents/'],
  ...guideRoutes,
  ['llms.txt', '/llms.txt'],
  ['llms-full.txt', '/llms-full.txt'],
  ['skill.md', '/skill.md'],
] as const

export const agentOutputNames: readonly string[] = agentRoutes.map(([path]) => path)
