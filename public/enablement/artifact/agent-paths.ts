export const agentRoutes = [
  ['agents/index.html', '/agents/'],
  ['llms.txt', '/llms.txt'],
  ['llms-full.txt', '/llms-full.txt'],
  ['skill.md', '/skill.md'],
] as const

export const agentOutputNames: readonly string[] = agentRoutes.map(([path]) => path)
