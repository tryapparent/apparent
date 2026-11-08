/** Bind conservative change selection to the existing component registrations. */
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { makePlan } from '../core.ts'
import { selectComponents, selectFromEvent } from './selector.ts'

export function platformPlan(root: string, selected: string[], mainUpdate = false) {
  const plan = makePlan(root)
  for (const id of selected) {
    if (!plan.matrix.include.some(row => row.id === id)) throw new Error(`Selected platform component is unavailable: ${id}`)
  }
  // Every main revision advances the installable Linux channel, reusing verified
  // component bytes when its complete input closure is unchanged. Other targets
  // retain their existing changed-component selection.
  const include = plan.matrix.include.filter(row => selected.includes(row.id) || (mainUpdate && row.id === 'app-shell' && row.target === 'linux-x64'))
  return { matrix: { include }, has_ready: include.length > 0 }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let selected: string[]
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'))
    selected = selectFromEvent(process.cwd(), process.env.GITHUB_EVENT_NAME ?? '', event)
  } catch {
    selected = selectComponents(null)
  }
  const plan = platformPlan(process.cwd(), selected, process.env.GITHUB_EVENT_NAME === 'push')
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(plan.matrix)}\nhas_ready=${plan.has_ready}\n`)
  console.log(JSON.stringify({ selected, ...plan }))
}
