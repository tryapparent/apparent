import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@apparent/ui/button';
import { Switch } from '@apparent/ui/switch';
import { ErrorDialog } from '@apparent/ui/error-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@apparent/ui/tabs';
import { StatusCard, type StatusTone } from '@apparent/ui/status-card';
import { NativeSelect, NativeSelectOption } from '@apparent/ui/native-select';
import '@apparent/ui/status.css';
import '@apparent/ui/overflow-button.css';

const source = 'https://github.com/tryapparent/apparent/blob/main/shared/ui/src/';
function Source({ file, example }: { file: string; example: string }) {
  return <details><summary>Usage and source</summary><pre><code>{example}</code></pre><a href={source + file}>Open {file}</a></details>;
}
function Library() {
  const [count, setCount] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [tone, setTone] = useState<StatusTone>('neutral');
  const [name, setName] = useState('My little frog project');
  const [submitted, setSubmitted] = useState(false);
  const [playful, setPlayful] = useState(true);
  const [errorOpen, setErrorOpen] = useState(false);
  const states: Record<StatusTone, [string, string]> = {
    neutral: ['Nothing here yet', 'Your next peculiar idea can start here.'],
    progress: ['Preparing your recording', 'Wait for the ready status before sharing. No invented percentage.'],
    success: ['Recording ready', 'The example recording is ready to watch.'],
    warning: ['Upload needs attention', 'The example recording is saved locally. Check your connection before retrying.'],
    failure: ['Upload failed', 'The example recording is saved locally. Choose Try again to return to the waiting example.'],
  };
  return <div className="bb-library">
    <p className="bb-example-label">Interactive examples. No recording, upload, account change or saved preference.</p>
    <article>
      <h3>Buttons</h3><p>One primary action, quieter alternatives, and an explanation for unavailable actions. These use the shared Button source.</p>
      <div className="bb-control-row">
        <Button className="bb-control" onClick={() => setCount(value => value + 1)}>Try a button</Button>
        <Button className="bb-control bb-secondary" variant="outline" onClick={() => setCount(0)}>Reset example</Button>
        <Button className="bb-control bb-secondary" disabled>Unavailable</Button>
      </div><p role="status">{count ? `Button tried ${count} ${count === 1 ? 'time' : 'times'}.` : 'Try the button. This example does not start a recording.'}</p>
      <p>The unavailable button demonstrates a native disabled state. Hover and keyboard focus remain visible on available controls.</p>
      <Source file="button.tsx" example={'import { Button } from "@apparent/ui/button";\n<Button onClick={handleAction}>Start recording</Button>\n<Button variant="outline">Cancel</Button>\n<Button disabled>Unavailable</Button>'} />
    </article>
    <article>
      <h3>Overflow actions</h3>
      <p>Use the ellipsis for secondary actions on a specific item.</p>
      <div className="bb-overflow-specimen" data-apparent-surface="stock">
        <div className="bb-overflow-row">
          <span>Work laptop</span>
          <Button variant="overflow" size="icon" aria-label="Manage work laptop" aria-expanded={actionsOpen}
            onClick={() => setActionsOpen(open => !open)}><MoreHorizontal aria-hidden="true" /></Button>
        </div>
        {actionsOpen && <p>Example actions for this computer would appear here.</p>}
      </div>
      <Source file="button.tsx" example={'<Button variant="overflow" size="icon" aria-label="Manage work laptop"\n  aria-expanded={open} onClick={toggleActions}>\n  <MoreHorizontal aria-hidden="true" />\n</Button>'} />
    </article>
    <article>
      <h3>Optional preference switch</h3>
      <p id="example-playful-help">Light or dark gray with a neutral edge when Off. Signal when On. The white thumb keeps the same neutral rim in both states. Thumb position and the accessible checked value also communicate state. No setting is saved.</p>
      {(['light', 'dark'] as const).map(theme => <div className={`bb-switch-specimen bb-switch-${theme}`} key={theme}>
        <h4>{theme === 'light' ? 'Light mode' : 'Dark mode'}</h4>
        <div className="bb-control-row">
          <span id={`example-playful-${theme}`}>Playful details</span>
          <Switch className="bb-switch" aria-labelledby={`example-playful-${theme}`} aria-describedby="example-playful-help" checked={playful} onCheckedChange={setPlayful} />
          <span aria-hidden="true">{playful ? 'On' : 'Off'}</span>
        </div>
        <div className="bb-control-row">
          <span id={`example-disabled-${theme}`}>Unavailable example</span>
          <Switch className="bb-switch" aria-labelledby={`example-disabled-${theme}`} checked={false} onCheckedChange={() => {}} disabled />
        </div>
      </div>)}
      <p>51 × 31px track and 27px thumb, with a 51 × 44px target. Real preferences save quietly; a wait cursor indicates saving and operational failures open ErrorDialog.</p>
      <Source file="forms/switch.tsx" example={'import { Switch } from "@apparent/ui/switch";\n<Switch aria-label="Playful details" checked={enabled} onCheckedChange={setEnabled} />'} />
    </article>
    <article>
      <h3>Error dialog</h3><p>The default popup for operational failures. It leaves page layout unchanged, traps keyboard focus and supports Escape. The recovery action comes first, with the group aligned left. Field validation remains beside its field.</p>
      <Button className="bb-control" onClick={()=>setErrorOpen(true)}>Show error example</Button>
      <ErrorDialog open={errorOpen} title="Unable to save preference" description="Refresh the saved value, then try again." recoveryLabel="Refresh preference"
        onRecover={()=>setErrorOpen(false)} onClose={()=>setErrorOpen(false)}/>
      <p>Demonstration only. Recovery closes this example without changing preferences. An optional artwork slot can reuse the update dialog’s puzzled frog.</p>
      <Source file="forms/error-dialog.tsx" example={'import { ErrorDialog } from "@apparent/ui/error-dialog";\n<ErrorDialog open={failed} title="Unable to save preference"\n  description="Refresh the saved value, then try again."\n  recoveryLabel="Refresh preference" onRecover={refresh} onClose={dismiss} />'} />
    </article>
    <article>
      <h3>Tabs</h3><p>Move between related views. Tab to the selected tab, then use Left/Right or Home/End. Entering a view does not grant permissions.</p>
      <Tabs defaultValue="expression"><TabsList className="bb-tab-list" aria-label="Collaboration examples">
        <TabsTrigger className="bb-tab" value="expression">Your expression</TabsTrigger>
        <TabsTrigger className="bb-tab" value="response">Agent response</TabsTrigger>
      </TabsList>
      <TabsContent className="bb-tab-panel" value="expression">Point to a detail, talk through an idea, or draw what you mean.</TabsContent>
      <TabsContent className="bb-tab-panel" value="response">A video walkthrough can show what the agent made. This is explanatory copy, not a live agent.</TabsContent></Tabs>
      <Source file="tabs.tsx" example={'import { Tabs, TabsList, TabsTrigger, TabsContent } from "@apparent/ui/tabs";\n<Tabs defaultValue="capture">\n  <TabsList aria-label="Views">\n    <TabsTrigger value="capture">Capture</TabsTrigger>\n  </TabsList>\n  <TabsContent value="capture">Content</TabsContent>\n</Tabs>'} />
    </article>
    <article>
      <h3>Fields and validation</h3><p>Keep labels visible and retain entered text after an error. This form only changes the example below.</p>
      <form className="bb-demo-form" onSubmit={event => {
        event.preventDefault();
        setSubmitted(true);
        if (!name.trim()) (event.currentTarget.elements.namedItem('projectName') as HTMLInputElement).focus();
      }} noValidate>
        <label htmlFor="example-name">Project name</label>
        <input id="example-name" name="projectName" type="text" autoComplete="off" value={name} onChange={event => {setName(event.target.value);setSubmitted(false);}} aria-invalid={submitted && !name.trim()} aria-describedby="example-name-help" />
        <p id="example-name-help">{submitted && !name.trim() ? 'Enter a project name to try this example.' : 'An example label, kept only while this page is open.'}</p>
        <Button className="bb-control" type="submit">Try validation</Button>
        <p role="status">{submitted && name.trim() ? 'Example accepted. Nothing was saved.' : ''}</p>
      </form>
    </article>
    <article>
      <h3>Status and recovery</h3><p>A written state and icon accompany each semantic color. Switch examples to inspect empty, waiting, ready, warning and error states.</p>
      <label htmlFor="example-state">Example state</label>
      <NativeSelect id="example-state" value={tone} onChange={event => setTone(event.target.value as StatusTone)}>
        <NativeSelectOption value="neutral">Empty</NativeSelectOption>
        <NativeSelectOption value="progress">Waiting</NativeSelectOption>
        <NativeSelectOption value="success">Ready</NativeSelectOption>
        <NativeSelectOption value="warning">Warning</NativeSelectOption>
        <NativeSelectOption value="failure">Error</NativeSelectOption>
      </NativeSelect>
      <StatusCard tone={tone} headline={states[tone][0]} compact>
        <p>{states[tone][1]}</p>
        {tone === 'failure' && <Button className="bb-control bb-secondary" variant="outline" onClick={() => setTone('progress')}>Try again</Button>}
      </StatusCard>
      <Source file="status-card.tsx" example={'import { StatusCard } from "@apparent/ui/status-card";\nimport "@apparent/ui/status.css";\n<StatusCard tone="failure" headline="Upload failed">\n  <p>Your recording is saved locally. Try uploading again.</p>\n</StatusCard>'} />
      <Source file="forms/native-select.tsx" example={'import { NativeSelect, NativeSelectOption } from "@apparent/ui/native-select";\n<label htmlFor="format">Format</label>\n<NativeSelect id="format">\n  <NativeSelectOption value="png">PNG</NativeSelectOption>\n</NativeSelect>'} />
    </article>
  </div>;
}
export function mountComponentLibrary() {
  const target = document.getElementById('brand-components');
  if (target) createRoot(target).render(<Library />);
}
