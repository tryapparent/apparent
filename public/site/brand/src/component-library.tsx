import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@apparent/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@apparent/ui/tabs';
import { StatusCard, type StatusTone } from '@apparent/ui/status-card';
import { NativeSelect, NativeSelectOption } from '@apparent/ui/native-select';
import '@apparent/ui/status.css';

const source = 'https://github.com/tryapparent/apparent/blob/main/shared/ui/src/';
function Source({ file, example }: { file: string; example: string }) {
  return <details><summary>Usage and source</summary><pre><code>{example}</code></pre><a href={source + file}>Open {file}</a></details>;
}
function Library() {
  const [count, setCount] = useState(0);
  const [tone, setTone] = useState<StatusTone>('neutral');
  const [name, setName] = useState('My little frog project');
  const [submitted, setSubmitted] = useState(false);
  const [playful, setPlayful] = useState(true);
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
      <h3>Optional preference switch</h3>
      <p id="example-playful-help">An in-memory example of an optional preference. Lilac means optional interaction in both states; thumb position and the accessible checked value communicate On or Off. No setting is saved.</p>
      <div className="bb-control-row">
        <span id="example-playful-label">Playful details</span>
        <Button className="bb-switch" role="switch" aria-labelledby="example-playful-label" aria-describedby="example-playful-help" aria-checked={playful} onClick={() => setPlayful(value => !value)}>
          <span className="bb-switch-track" aria-hidden="true"><span className="bb-switch-thumb" /></span>
        </Button>
        <span aria-hidden="true">{playful ? 'On' : 'Off'}</span>
      </div>
      <p>48 × 24px Lilac track, 18px Carbon thumb, no track outline in either theme. The focus indicator surrounds the 44px-tall interaction target. Real preferences save quietly; waiting and recoverable errors belong inline.</p>
      <p>This composition uses shared Button with switch semantics; it does not claim a separate shared Switch component.</p>
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
