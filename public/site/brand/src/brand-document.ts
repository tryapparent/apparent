const asset = (path) => `/brand/assets/${path}`;

const rule = (label, text, tone = '') => `
  <article class="bb-rule ${tone}">
    <small>${label}</small>
    <p>${text}</p>
  </article>
`;

const sections = [
  {
    title: 'Brand foundations',
    summary: 'The strategic definitions that every expression of apparent must preserve.',
    body: `
      <div class="bb-definition-grid">
        <div><small>NAME</small><strong>apparent</strong><p>Always lowercase, including at the start of a sentence, in headings, titles, metadata and navigation.</p></div>
        <div><small>CATEGORY</small><strong>AI-ready operational data</strong></div>
        <div><small>COMPANY</small><strong>The operational-data platform for AI-native companies.</strong></div>
        <div><small>ENDURING PROMISE</small><strong>Operational data you can build on.</strong></div>
        <div><small>PRODUCT PROPOSITION</small><strong>Documents <em>ready</em> for AI.</strong></div>
      </div>
      <div class="bb-callout"><strong>Mandatory naming rule</strong><p>Write <b>apparent</b>. Never write “Apparent” or “APPARENT.” The lowercase form is a proper-name exception and must not be autocorrected.</p></div>
      <h2>Digital names</h2>
      <div class="bb-spec-table">
        <div><small>DISPLAY NAME</small><p>Use <b>apparent</b> wherever a plain display name is available.</p></div>
        <div><small>UNIQUE HANDLE</small><p>Use <b>tryapparent</b> whenever <b>apparent</b> is unavailable or the service requires a globally unique name.</p></div>
        <div><small>URL EXAMPLES</small><p><code>linkedin.com/company/tryapparent</code><br><code>github.com/tryapparent</code></p></div>
        <div><small>DO NOT VARY</small><p>Do not switch between getapparent, apparent-ai, apparent-hq or local variants.</p></div>
      </div>
      <h2>Audience</h2>
      <p>Acquisition-led companies such as roll-ups, serial acquirers and PE-backed platforms that need to turn fragmented operational knowledge across acquired businesses into structured, trustworthy data.</p>
      <div class="bb-callout"><strong>Initial market focus</strong><p>Property management is the starting vertical, not the long-term boundary of the brand.</p></div>
      <h2>Product description</h2>
      <p>apparent ingests documents, classifies and sorts them by type, then extracts the relevant data. Every extracted value remains linked to its source. The result is structured, traceable output that can be imported into company systems or used in AI workflows.</p>
      <div class="bb-callout"><strong>Short form</strong><p>apparent turns documents into structured, traceable data ready for company systems and AI workflows.</p></div>
      <h2>Brand character</h2>
      <div class="bb-rule-grid">
        ${rule('LEAN', 'Remove what does not improve understanding. Do not leave work looking sparse or unfinished.')}
        ${rule('FAST', 'Use decisive hierarchy and direct language. Never imply speed at the expense of control.')}
        ${rule('TECHNICAL', 'Be exact about inputs, outputs and limitations. Do not use complexity as theatre.')}
        ${rule('ASSURED', 'State the claim and attach proof. Avoid corporate padding and unsupported superlatives.')}
        ${rule('PRECISE', 'Name the source, timeframe and status. Do not become bureaucratic.')}
      </div>
    `,
  },
  {
    title: 'Logo',
    summary: 'The apparent logo system contains a primary wordmark and a compact brand icon. Use the supplied masters without cropping or rebuilding them.',
    body: `
      <h2>Brand icon</h2>
      <div class="bb-mark-board">
        <figure class="paper"><img src="${asset('brand/apparent-icon.svg')}" alt="Primary apparent brand icon"><figcaption><b>PRIMARY ICON</b><span>Lilac “a” on Carbon</span></figcaption></figure>
        <figure class="carbon"><img src="${asset('brand/apparent-icon-inverse.svg')}" alt="Inverse apparent brand icon"><figcaption><b>INVERSE ICON</b><span>Carbon “a” on Lilac</span></figcaption></figure>
      </div>
      <p>The brand icon is the boxed lowercase “a.” Use it for favicons, avatars and compact controls. It does not replace the full wordmark when the name fits.</p>
      <div class="bb-construction-values">
        <div><small>MASTER CANVAS</small><strong>512 × 512</strong><p>The icon is always square.</p></div>
        <div><small>HORIZONTAL INSET</small><strong>73 px</strong><p>14.3% on the left and right.</p></div>
        <div><small>VERTICAL INSET</small><strong>69 px</strong><p>13.5% on the top and bottom.</p></div>
        <div><small>EXTERNAL CLEAR SPACE</small><strong>0.5x</strong><p>x equals the icon width.</p></div>
        <div><small>DIGITAL MINIMUM</small><strong>24 × 24 px</strong><p>Use the SVG master.</p></div>
      </div>
      <h2>Wordmark</h2>
      <div class="bb-logo-board">
        <figure class="light"><img src="${asset('brand/apparent-wordmark.svg')}" alt="Primary apparent wordmark"><figcaption>Primary / Carbon on Lilac</figcaption></figure>
        <figure class="dark"><img src="${asset('brand/apparent-wordmark-inverse.svg')}" alt="Inverse apparent wordmark"><figcaption>Inverse / Lilac on Carbon</figcaption></figure>
      </div>
      <p>The color box is part of the wordmark. Never remove it, crop it to the letters or recreate its padding with CSS.</p>
      <h2>Wordmark construction</h2>
      <div class="bb-clearspace-diagram">
        <span class="top">0.5x clear space</span><span class="left">0.5x</span>
        <div class="bb-protected-mark"><img src="${asset('brand/apparent-wordmark.svg')}" alt="apparent wordmark construction"><i>INK AREA</i></div>
        <small>x = color-box height</small>
      </div>
      <div class="bb-construction-values">
        <div><small>MASTER CANVAS</small><strong>2215 × 512</strong><p>Use the complete SVG viewBox.</p></div>
        <div><small>HORIZONTAL INSET</small><strong>90 px</strong><p>17.6% of x on the left and right.</p></div>
        <div><small>VERTICAL INSET</small><strong>44 px</strong><p>8.6% of x on the top and bottom.</p></div>
        <div><small>EXTERNAL CLEAR SPACE</small><strong>0.5x</strong><p>Keep clear on every side.</p></div>
      </div>
      <div class="bb-callout"><strong>Implementation rule</strong><p>Internal inset belongs to the asset. External clear space belongs to the layout. Do not count the built-in color-box inset as external clear space.</p></div>
      <h2>Usage</h2>
      <div class="bb-spec-table">
        <div><small>DEFAULT</small><p>Use the full wordmark whenever the name fits.</p></div>
        <div><small>COMPACT</small><p>Use the boxed “a” only for favicons, avatars and controls where the name cannot fit.</p></div>
        <div><small>CLEAR SPACE</small><p>Keep 0.5x around the complete color box, where x equals its height.</p></div>
        <div><small>MINIMUM</small><p>Wordmark: 120 px wide digital. Brand icon: 24 × 24 px digital.</p></div>
        <div><small>BACKGROUND</small><p>Use the primary or inverse boxed master. The box remains intact on every surface.</p></div>
        <div><small>FORMAT</small><p>SVG for digital. PNG only where SVG is unsupported. Print masters are not yet approved.</p></div>
      </div>
      <h2>Incorrect use</h2>
      <div class="bb-rule-grid">
        ${rule('DO NOT', 'Stretch, rotate, crop or redraw the wordmark.', 'negative')}
        ${rule('DO NOT', 'Rebuild the wordmark with live type or separate its letters.', 'negative')}
        ${rule('DO NOT', 'Add shadows, outlines, gradients or unapproved colors.', 'negative')}
        ${rule('DO NOT', 'Use the icon as the primary identifier when the full name fits.', 'negative')}
      </div>
      <div class="bb-download-row"><a href="${asset('brand/apparent-wordmark.svg')}">Primary wordmark SVG</a><a href="${asset('brand/apparent-wordmark-inverse.svg')}">Inverse wordmark SVG</a><a href="${asset('brand/apparent-icon.svg')}">Primary icon SVG</a><a href="${asset('brand/apparent-icon-inverse.svg')}">Inverse icon SVG</a><a download href="${asset('brand/apparent-icon.png')}">Primary icon PNG</a><a download href="${asset('brand/apparent-icon-inverse.png')}">Inverse icon PNG</a></div>
    `,
  },
  {
    title: 'Color',
    summary: 'Use the five approved colors by role. Signal is reserved for one decisive action or transition.',
    body: `
      <div class="bb-color-table">
        <div style="--swatch:#F5F0E8"><span></span><small>PAPER</small><strong>#F5F0E8</strong><p>245 / 240 / 232</p><p>Primary reading surface</p></div>
        <div style="--swatch:#E7E0EE"><span></span><small>STOCK</small><strong>#E7E0EE</strong><p>231 / 224 / 238</p><p>Grouped structure</p></div>
        <div class="dark" style="--swatch:#020102"><span></span><small>CARBON</small><strong>#020102</strong><p>2 / 1 / 2</p><p>Text and inverse field</p></div>
        <div style="--swatch:#B7A5D8"><span></span><small>LILAC</small><strong>#B7A5D8</strong><p>183 / 165 / 216</p><p>Selection and depth</p></div>
        <div class="dark" style="--swatch:#7A58C7"><span></span><small>SIGNAL</small><strong>#7A58C7</strong><p>122 / 88 / 199</p><p>One action or transition</p></div>
      </div>
      <h2>Approved text pairings</h2>
      <div class="bb-contrast-list">
        <div><b>18.37:1</b><span>Carbon on Paper</span><small>AA / AAA</small></div>
        <div><b>4.57:1</b><span>Signal on Paper</span><small>AA</small></div>
        <div><b>9.31:1</b><span>Carbon on Lilac</span><small>AA / AAA</small></div>
        <div><b>4.57:1</b><span>Paper on Signal</span><small>AA</small></div>
      </div>
      <div class="bb-callout warning"><strong>Restricted</strong><p>Normal-size Signal text is allowed only on Paper. On Stock or Carbon, reserve Signal for non-text UI, focus, graphics, large text, or filled controls with Paper text. Signal and Lilac need a second non-color distinction.</p></div>
      <h2>Functional status colors</h2>
      <div class="bb-spec-table bb-status-grid">
        <div class="success"><small>SUCCESS</small><strong>#146B43</strong><p>Completed, confirmed, delivered or healthy. Contrast on Paper: 5.76:1.</p></div>
        <div class="in-progress"><small>IN PROGRESS</small><strong>#7A58C7</strong><p>Processing, retrying, queued or incomplete. Uses Signal; contrast on Paper: 4.57:1.</p></div>
        <div class="warning-status"><small>WARNING</small><strong>#FFBE2E</strong><p>Preventive caution before failure. Carbon on gold: 12.56:1.</p></div>
        <div class="failure"><small>FAILURE</small><strong>#B42318</strong><p>Failed, unavailable, invalid, blocked or action required. Contrast on Paper: 5.80:1.</p></div>
        <div class="destructive"><small>DESTRUCTIVE</small><strong>#B42318</strong><p>Aliases failure red, but retains explicit language and confirmation.</p></div>
        <div class="disabled-status"><small>DISABLED</small><strong>Carbon / 45%</strong><p>Unavailable controls only. Keep informative explanations at readable Carbon contrast.</p></div>
        <div class="redundancy"><small>REDUNDANCY</small><strong>Label plus cue</strong><p>Always add a written state and icon, outline, pattern or shape. Never rely on color alone.</p></div>
      </div>
      <p>Default to light fields with strong bars or icons. Reserve solid semantic fields for actions and escalation. Signal may connect one active workflow across progress, focus, route and primary action; avoid unrelated Signal emphasis in the same component.</p>
      <div class="bb-callout warning"><strong>Warning contrast</strong><p>Use Carbon text on gold. Paper text on warning gold is prohibited. Failure and destructive share a hue but remain separate semantic tokens and behaviors.</p></div>
      <p class="bb-status-note">CMYK and spot-color equivalents are not approved until a physical print proof is completed.</p>
    `,
  },
  {
    title: 'Typeface',
    summary: 'Host Grotesk is the only approved typeface. Use weight and density to create hierarchy. Do not add type families.',
    body: `
      <div class="bb-type-specimen"><small>HOST GROTESK / 400 · 500 · 700</small><strong>Aa Bb Cc 0123456789</strong><p>Operational data you can build on.</p></div>
      <h2>Approved scale</h2>
      <div class="bb-type-table">
        <div><small>PRESENTATION</small><b>120 / 60 / 30</b><p>Hero, title and supporting copy.</p></div>
        <div><small>PRODUCT</small><b>36 / 18 / 16</b><p>Heading, interface body and short metadata.</p></div>
        <div><small>BODY COPY</small><b>18 / 27</b><p>55–75 characters per line.</p></div>
        <div><small>NUMERALS</small><b>Tabular</b><p>Always include unit, denominator and timeframe.</p></div>
      </div>
      <h2>Implementation</h2>
      <pre><code>font-family: "Host Grotesk", system-ui, sans-serif;
font-size: 36px | 18px | 16px;
font-weight: 400 | 500 | 700;</code></pre>
      <p>Do not introduce intermediate sizes. Use weight, spacing and grouping to create secondary hierarchy.</p>
      <div class="bb-callout"><strong>Accessibility floor</strong><p>Use 16 px only for short companion text such as timestamps, qualifiers and secondary table labels. Body copy, controls, form labels, validation and critical status must remain 18 px or larger.</p></div>
      <div class="bb-spec-table">
        <div><small>RESIZE</small><p>Text must resize to 200% without clipping, overlap or loss of function.</p></div>
        <div><small>REFLOW</small><p>Content must reflow at 320 CSS px without horizontal scrolling for reading.</p></div>
        <div><small>SPACING</small><p>Support 1.5× line height, 0.12× letter spacing and 0.16× word spacing overrides.</p></div>
        <div><small>UNITS</small><p>Implement type in rem from a 16 px user-agent root. Do not block browser text settings.</p></div>
      </div>
      <p class="bb-source-note">Accessibility basis: <a href="https://www.w3.org/TR/WCAG22/">WCAG 2.2</a> and <a href="https://designsystem.digital.gov/components/typography/">U.S. Web Design System typography guidance</a>.</p>
      <p>Host Grotesk is distributed under the SIL Open Font License 1.1. Keep the license with the font files.</p>
    `,
  },
  {
    title: 'Layout',
    summary: 'Use one structural grid and place evidence beside the decision it supports.',
    body: `
      <div class="bb-grid-demo" aria-label="Twelve-column layout grid">${Array.from({ length: 12 }, (_, index) => `<i>${index + 1}</i>`).join('')}</div>
      <div class="bb-spec-table">
        <div><small>DESKTOP</small><p>12 columns with 24 px gutters.</p></div>
        <div><small>PRODUCT</small><p>Use a 7:5 evidence-to-decision split where review is required.</p></div>
        <div><small>SPACING</small><p>Use the 8 px spacing system. Prefer 16, 24, 32, 48 and 64 px.</p></div>
        <div><small>ALIGNMENT</small><p>Share baselines and edges. Do not center unrelated blocks.</p></div>
        <div><small>DENSITY</small><p>Marketing may breathe; product must remain compact and auditable.</p></div>
        <div><small>MOTION</small><p>120–200 ms ease-out. Motion must represent a state change.</p></div>
      </div>
      <div class="bb-callout"><strong>Required</strong><p>Reduced-motion alternatives must be available. Never animate fake progress or use movement only for decoration.</p></div>
    `,
  },
  {
    title: 'Highlighting',
    summary: 'The highlighter is an approved brand device. It shows structure made visible inside a document and connects source evidence to usable data.',
    body: `
      <div class="bb-highlight-demo">
        <small>SOURCE TO STRUCTURE</small>
        <p>Turn documents into <mark>operational data</mark> and keep the evidence attached.</p>
        <div><span>UNSTRUCTURED SOURCE</span><i></i><strong>REVIEWABLE FIELD</strong></div>
      </div>
      <h2>Meaning</h2>
      <p>The color field behind the apparent wordmark should feel like a highlighter mark. Highlighting is a functional metaphor for apparent: it finds the part that matters, reveals structure and makes document knowledge easier to use.</p>
      <h2>Rules</h2>
      <div class="bb-rule-grid">
        ${rule('USE LILAC', 'Mark source evidence, extracted fields, selected regions and information that has become structured.', 'positive')}
        ${rule('USE SIGNAL', 'Mark one decisive action, handoff or transition. Signal is not a general-purpose highlighter.')}
        ${rule('KEEP IT RECTANGULAR', 'Use a flat, square-edged field close to the text or source region. A slight imperfect offset is allowed in expressive brand work.')}
        ${rule('KEEP THE LINK', 'A highlight must point to meaningful text, a source region or an explicit state change. It never floats as decoration.')}
        ${rule('PROTECT LEGIBILITY', 'Use Carbon on Lilac and Paper on Signal. Never use white text on Lilac.', 'positive')}
        ${rule('DO NOT', 'Cover whole paragraphs, stack many colors, imitate fluorescent marker textures or turn every heading into a highlight.', 'negative')}
      </div>
      <div class="bb-callout"><strong>Wordmark link</strong><p>The boxed wordmark is the primary expression of this device. Other highlights should support it, not compete with it.</p></div>
    `,
  },
  {
    title: 'Photography',
    summary: 'Show operational evidence, its context and the human decision. Do not use generic technology symbolism.',
    body: `
      <div class="bb-photo-grid">
        <figure><img src="${asset('photos/status-archive-md-jawadur-rahman-pexels.jpg')}" alt="Archived paper documents"><figcaption><b>APPROVED / EVIDENCE</b> Close enough to see material, condition and provenance.</figcaption></figure>
        <figure><img src="${asset('photos/sam-industrial-park-wikimedia.jpg')}" alt="Industrial operating environment"><figcaption><b>APPROVED / CONTEXT</b> Show where knowledge affects real operations.</figcaption></figure>
        <figure class="transition"><img src="${asset('photos/som-berlin-facade-pexels.jpg')}" alt="Building facade"><figcaption><b>APPROVED / CHANGE</b> Signal may mark a real boundary or state transition.</figcaption></figure>
      </div>
      <div class="bb-rule-grid">
        ${rule('USE', 'Documents, operators, decisions, operating environments and resolved action.', 'positive')}
        ${rule('AVOID', 'Robots, AI glow, code rain, staged handshakes and anonymous corporate scale.', 'negative')}
        ${rule('COMPOSITION', 'Prefer documentary framing, natural light, visible texture and specific context.')}
        ${rule('SAFETY', 'Redact private data, confirm subject permission and record source plus license.')}
      </div>
    `,
  },
  {
    title: 'Iconography',
    summary: 'Icons clarify actions and states. They do not replace the apparent wordmark or decorate empty space.',
    body: `
      <div class="bb-icon-sample"><img src="${asset('brand/apparent-icon.svg')}" alt="apparent compact icon"><div><small>BRAND ICON</small><strong>Boxed lowercase “a”</strong><p>Reserved for compact brand identification such as avatars and favicons.</p></div></div>
      <div class="bb-spec-table">
        <div><small>STYLE</small><p>Simple geometric forms with one consistent stroke weight.</p></div>
        <div><small>SIZES</small><p>16, 20 and 24 px in product interfaces.</p></div>
        <div><small>COLOR</small><p>Carbon by default; Signal only for the active or primary state.</p></div>
        <div><small>LABELS</small><p>Pair unfamiliar icons with text. Never rely on color alone.</p></div>
      </div>
      <div class="bb-callout warning"><strong>Not yet defined</strong><p>No standalone illustration system or expanded product-icon library is approved. Do not invent either without review.</p></div>
    `,
  },
  {
    title: 'Voice and tone',
    summary: 'apparent is direct, technically exact and calm. Tone adapts to context; the voice does not.',
    body: `
      <div class="bb-voice-table">
        <div><small>WEBSITE + SALES</small><strong>Decisive and outcome-led</strong><p>State the operational constraint, the action and the proof.</p></div>
        <div><small>PRODUCT</small><strong>Compact and literal</strong><p>Use direct verbs, visible status and explicit consequences.</p></div>
        <div><small>SUPPORT</small><strong>Calm and accountable</strong><p>Name what happened, what is known and the next step.</p></div>
        <div><small>TECHNICAL</small><strong>Exact and qualified</strong><p>Define inputs, outputs, limits and evidence status.</p></div>
      </div>
      <h2>Vocabulary</h2>
      <div class="bb-copy-pairs">
        <div class="positive"><small>USE</small><p>Ready to automate.</p><p>Source evidence attached.</p><p>Review required.</p></div>
        <div class="negative"><small>AVOID</small><p>Effortless transformation.</p><p>AI magic.</p><p>Revolutionary accuracy.</p></div>
      </div>
      <h2>Sentence rules</h2>
      <ul><li>Lead with the subject and a direct verb.</li><li>Prefer concrete nouns over abstract promises.</li><li>Use sentence case. Avoid exclamation marks and inflated superlatives.</li><li>Qualify forecasts, estimates, illustrative examples and incomplete evidence.</li></ul>
    `,
  },
  {
    title: 'Writing',
    summary: 'Write with the speed of a startup and the control of a scale-up: direct, compact, specific and provable.',
    body: `
      <h2>Core rules</h2>
      <ol class="bb-writing-rules">
        <li><b>Lead with the fact</b><p>Start with the operational truth the reader needs. Do not begin with scene-setting or a broad claim about the future.</p></li>
        <li><b>Name the actor and action</b><p>Prefer subject + verb + object: “apparent attaches the source page.” Avoid passive constructions that hide responsibility.</p></li>
        <li><b>Use short, concrete words</b><p>Write “use,” “start,” “show,” and “fix.” Avoid “utilize,” “initiate,” “demonstrate,” and “remediate” when the shorter word means the same thing.</p></li>
        <li><b>Cut every word that does no work</b><p>Remove throat-clearing, repeated conclusions and adjectives that do not change the meaning.</p></li>
        <li><b>Keep one claim per sentence</b><p>Aim for 8–18 words. Use more only when a technical condition cannot be split without losing accuracy.</p></li>
        <li><b>Attach proof to the claim</b><p>Name the source, timeframe and evidence status in the same paragraph. Label estimates, forecasts and illustrative examples.</p></li>
      </ol>
      <h2>Capitalization and punctuation</h2>
      <div class="bb-spec-table">
        <div><small>BRAND NAME</small><p>Always write <b>apparent</b> in lowercase, including sentence starts, headings, titles, metadata and navigation.</p></div>
        <div><small>HEADINGS</small><p>Use sentence case. Capitalize only the first word and proper nouns other than <b>apparent</b>.</p></div>
        <div><small>IDENTIFIERS</small><p>Use the approved prefixed ULID format, such as <code>doc_01JQ7M6J8H9T2R4K5N6P7Q8S9T</code>.</p></div>
        <div><small>PUNCTUATION</small><p>Prefer periods. Use a colon for definitions. Use parentheses only for necessary qualification.</p></div>
        <div><small>DATES</small><p>Use European numeric dates with leading zeros: <b>DD.MM.YYYY</b>. Write 24-hour local time as <b>HH:mm</b> and name the local zone, for example <b>09:42 CEST</b>. Reserve UTC for technical logs or genuinely cross-region coordination.</p></div>
        <div><small>EM DASH</small><p>Never use em dashes. Use a period, comma, colon or parentheses instead.</p></div>
        <div><small>EMPHASIS</small><p>Do not use exclamation marks, repeated fragments, emoji or decorative Unicode type to manufacture energy.</p></div>
      </div>
      <h2>Vocabulary</h2>
      <div class="bb-word-list">
        <div><small>PREFER</small><p>operational data</p><p>source evidence</p><p>ready for review</p><p>structured and usable</p><p>move faster</p><p>stay in control</p></div>
        <div><small>USE ONLY WITH PROOF</small><p>accurate</p><p>faster</p><p>reliable</p><p>automated</p><p>scalable</p><p>secure</p></div>
        <div><small>AVOID</small><p>magic</p><p>seamless</p><p>revolutionary</p><p>game-changing</p><p>unlock the power of</p><p>in today’s fast-paced world</p></div>
      </div>
      <h2>Before and after</h2>
      <div class="bb-copy-edits">
        <div><small>BEFORE</small><p>Our revolutionary AI-powered platform seamlessly unlocks the value hidden across your complex document ecosystem.</p></div>
        <div><small>AFTER</small><p>apparent turns documents into structured, traceable data ready for company systems and AI workflows.</p></div>
        <div><small>BEFORE</small><p>Errors can be efficiently remediated by users through our intuitive review experience.</p></div>
        <div><small>AFTER</small><p>Reviewers see the source, correct the field and confirm the result.</p></div>
      </div>
      <h2>LLM writing instruction</h2>
      <p>Paste this block into any LLM prompt before requesting apparent copy:</p>
      <pre class="bb-llm-prompt"><code>You write for apparent. Always spell apparent in lowercase.
Write in a direct, compact and technically exact voice.
Lead with the operational fact. Use active subject–verb–object sentences.
Prefer short, concrete words. Cut setup, repetition and empty adjectives.
Keep one claim per sentence and attach proof, source and timeframe where relevant.
Label estimates, forecasts and illustrative examples. Never invent evidence.
Use sentence case and periods. Do not use hype, exclamation marks or slogan stacks.
Avoid: magic, seamless, revolutionary, game-changing, unlock the power of.
Never use em dashes.
If evidence or context is missing, mark the gap instead of filling it in.</code></pre>
      <h2>LLM input requirements</h2>
      <div class="bb-checklist"><label><input type="checkbox" disabled> Audience and channel</label><label><input type="checkbox" disabled> Single communication objective</label><label><input type="checkbox" disabled> Approved facts and source links</label><label><input type="checkbox" disabled> Evidence status and timeframe</label><label><input type="checkbox" disabled> Required action or next step</label><label><input type="checkbox" disabled> Terms that must remain exact</label></div>
      <div class="bb-callout"><strong>Final check</strong><p>Does every sentence say who did what, with what evidence? If not, revise it before publishing.</p></div>
    `,
  },
  {
    title: 'Data visualization',
    summary: 'Charts must make the relationship and the evidence status auditable.',
    body: `
      <div class="bb-data-example">
        <header><small>DOCUMENT THROUGHPUT / LAST 30 DAYS</small><span>Illustrative</span></header>
        <div><label>Received</label><i style="--w:100%"></i><b>52,940</b></div>
        <div><label>Structured</label><i style="--w:83%"></i><b>43,820</b></div>
        <div><label>Ready</label><i style="--w:82%"></i><b>43,624</b></div>
        <footer>Illustrative operational dataset · refreshed 22.07.2026, 09:42 CEST</footer>
      </div>
      <h2>Required anatomy</h2>
      <ol class="bb-numbered-rules"><li><b>Metric</b><span>Name the measure and denominator.</span></li><li><b>Time</b><span>State the window and named local zone.</span></li><li><b>Source</b><span>Name the source and refresh time.</span></li><li><b>Status</b><span>Mark actual, estimate, forecast or illustrative.</span></li><li><b>Uncertainty</b><span>Show thresholds and incomplete intervals.</span></li></ol>
      <h2>Approved chart grammar</h2>
      <div class="bb-product-principles">
        <div><small>COMPARISON</small><strong>Aligned bars or dots</strong><p>Use a shared baseline and place the exact value beside each mark.</p></div>
        <div><small>TREND</small><strong>Time series</strong><p>Label the time range, named local zone, units, refresh time and incomplete intervals.</p></div>
        <div><small>UNCERTAINTY</small><strong>Range or threshold</strong><p>Show assumptions, limits and review consequences with text plus pattern or line style.</p></div>
        <div><small>PROCESS</small><strong>Stages or funnel</strong><p>Name the denominator at every stage and preserve a path to the underlying evidence.</p></div>
      </div>
      <h2>Implementation system</h2>
      <div class="bb-spec-table">
        <div><small>ENGINE</small><strong>LayerChart 2</strong><p>The single Svelte chart engine. Use it only inside the shared chart directory.</p></div>
        <div><small>RECIPE</small><strong>shadcn-svelte</strong><p>An optional source starting point. Do not adopt its default chart colors or presentation.</p></div>
        <div><small>PRODUCT API</small><strong>apparent chart components</strong><p>Feature routes consume named comparison, trend, range, process and qualified-metric components.</p></div>
        <div><small>VISUAL AUTHORITY</small><strong>apparent tokens</strong><p>Carbon sets baselines, Lilac comparison structure and Signal one selected series or threshold.</p></div>
      </div>
      <h2>Accessible delivery</h2>
      <div class="bb-rule-grid">
        ${rule('DIRECT LABELS', 'Place series names and exact values beside their marks wherever space allows.', 'positive')}
        ${rule('TOOLTIP', 'Use a tooltip for added detail only. It must not contain the only value, label, source or qualification.')}
        ${rule('TEXT AND TABLE', 'Provide a concise summary and an accessible table or equivalent data view.', 'positive')}
        ${rule('RESPONSIVE', 'Recompose at narrow widths without removing evidence or requiring horizontal reading.')}
      </div>
      <h2>Color and scale</h2>
      <p>Use direct labels, truthful proportions, aligned position or length and shared baselines. Pair every color distinction with text, dash, pattern, outline or another non-color cue.</p>
      <div class="bb-callout"><strong>Core plus pattern</strong><p>Add no categorical hues. Use Signal solid for one selected series, Lilac and Carbon for comparisons, then repeat Lilac and Carbon only with direct labels plus distinct dash, pattern or outline. Keep at most five visible series; beyond that, filter, group, use small multiples or provide a table.</p></div>
      <h2>Do not use</h2>
      <p>Do not use decorative 3D treatments, decorative or value-encoding gradients, unlabeled axes, color-matching legends or library-default palettes. CSS gradient functions may render approved hatch or dot patterns only. Avoid dual axes and radial charts when aligned position or length communicates the relationship more accurately. Prefer SVG or semantic HTML; Canvas requires an equivalent accessible summary and data view.</p>
      <div class="bb-download-row"><a href="/brand/design-system/svelte-component-system.md#chart-system">Chart implementation system</a><a href="/brand/design-system/product-interface.md#metrics-tables-and-charts">Product chart rules</a><a href="/brand/design-system/tokens/apparent.css">CSS tokens</a></div>
    `,
  },
  {
    title: 'Identifiers',
    summary: 'Use prefixed ULIDs as the single canonical identifier format for documents, runs and other durable product objects.',
    body: `
      <div class="bb-identifier-hero"><small>CANONICAL EXAMPLE</small><code>run_01JQ7M6J8H9T2R4K5N6P7Q8S9T</code><p>A short lowercase type prefix, one underscore and a 26-character uppercase ULID.</p></div>
      <h2>Approved prefixes</h2>
      <div class="bb-spec-table">
        <div><small>DOCUMENT</small><p><code>doc_</code> for one source document.</p></div>
        <div><small>RUN</small><p><code>run_</code> for one processing attempt.</p></div>
        <div><small>BATCH</small><p><code>bat_</code> for a submitted group.</p></div>
        <div><small>REVIEW</small><p><code>rev_</code> for one durable review decision.</p></div>
        <div><small>OUTPUT</small><p><code>out_</code> for one structured output.</p></div>
      </div>
      <h2>System rules</h2>
      <ol class="bb-writing-rules">
        <li><b>Generate once</b><p>Identifiers are immutable, never recycled and stable across retries. Reprocessing creates a new <code>run_</code>.</p></li>
        <li><b>Treat as opaque</b><p>Do not derive permissions or business logic from the prefix, order or embedded timestamp.</p></li>
        <li><b>Separate security</b><p>An identifier is not an authorization token. Access control must be enforced independently.</p></li>
        <li><b>Keep people out</b><p>Never include names, filenames, customer data, dates or other personal information.</p></li>
        <li><b>Preserve the value</b><p>Store as 128-bit binary where supported. APIs return the full prefixed string.</p></li>
        <li><b>Show it safely</b><p>Detail views and copy actions expose the full ID. Dense tables may shorten it visually but must copy and announce the full value.</p></li>
      </ol>
      <div class="bb-copy-pairs">
        <div class="positive"><small>USE</small><p><code>doc_01JQ7M6J8H9T2R4K5N6P7Q8S9T</code></p><p><code>run_01JQ7N1D4A8K2P6R7T9V0W3X5Y</code></p></div>
        <div class="negative"><small>AVOID</small><p><code>104928</code> predictable sequence</p><p><code>blue-crazy-car</code> human label</p><p><code>customer-invoice-21.07.2026</code> private data</p></div>
      </div>
      <p class="bb-source-note">Technical basis: <a href="https://www.ietf.org/rfc/rfc9562.html">IETF RFC 9562</a> for 128-bit UUID semantics and <a href="https://github.com/ulid/spec">the ULID specification</a> for sortable, URL-safe encoding.</p>
    `,
  },
  {
    title: 'Product interfaces',
    summary: 'Product surfaces prioritize evidence, review state and the next safe action.',
    body: `
      <div class="bb-product-principles">
        <div><small>EVIDENCE</small><strong>Evidence remains attached</strong><p>Every extracted value links back to its source page or region.</p></div>
        <div><small>CONFIDENCE</small><strong>Confidence is qualified</strong><p>Display the threshold and the review consequence, not a decorative percentage.</p></div>
        <div><small>ACTION</small><strong>Actions are explicit</strong><p>Buttons describe the state change: “Confirm field,” not “Continue.”</p></div>
        <div><small>RECOVERY</small><strong>Failure is recoverable</strong><p>Name the error, preserve work and provide a next step.</p></div>
      </div>
      <div class="bb-callout"><strong>Titles stand alone</strong><p>Do not prefix ordinary product sections with decorative numbers such as 01 or 02. Number only genuine ordered steps when sequence affects completion or meaning.</p></div>
      <div class="bb-callout"><strong>Recent first, relative first</strong><p>Time-based results and activity default to newest first and expose their sort. Use relative time when recency matters; keep the exact local date, time and named zone available for audit and precision.</p></div>
      <p>Canonical behavior, accessibility and component guidance live in <code>design-system/product-interface.md</code>. Product implementation takes precedence over illustrative marketing specimens.</p>
    `,
  },
  {
    title: 'Frontend design system',
    summary: 'Frontend work uses shared tokens, semantic components and explicit behavior contracts. A screen is not complete when only its default state looks correct.',
    body: `
      <h2>Source precedence</h2>
      <div class="bb-priority-stack">
        <div><small>01</small><strong>Safety, privacy and WCAG 2.2 AA</strong></div>
        <div><small>02</small><strong>Semantic HTML and product behavior</strong></div>
        <div><small>03</small><strong>apparent tokens and approved assets</strong></div>
        <div><small>04</small><strong>Shared components and patterns</strong></div>
        <div><small>05</small><strong>Page-level composition</strong></div>
      </div>
      <h2>Foundation contract</h2>
      <div class="bb-spec-table">
        <div><small>TYPE</small><p>Host Grotesk at 36 / 18 / 16. Use rem. Keep controls and form text at 18 or larger.</p></div>
        <div><small>SPACE</small><p>8 px base. Prefer 16, 24, 32, 48 and 64.</p></div>
        <div><small>LAYOUT</small><p>12 columns, 24 px gutters and 32 px desktop inset. Review screens prefer a 7:5 evidence-to-decision split.</p></div>
        <div><small>GEOMETRY</small><p>Square corners, 1 px Carbon rules and a visible 2 px or stronger Signal focus treatment.</p></div>
        <div><small>MOTION</small><p>120 to 200 ms for real state changes. Respect reduced motion. Never animate fake progress.</p></div>
        <div><small>TARGETS</small><p>44 × 44 px internal minimum for primary controls. This exceeds the 24 × 24 px WCAG 2.2 AA floor.</p></div>
      </div>
      <h2>Approved Svelte system</h2>
      <div class="bb-spec-table">
        <div><small>COMPONENT LIBRARY</small><strong>Bits UI</strong><p>The single headless runtime dependency for accessible behavior, keyboard interaction and focus management.</p></div>
        <div><small>COMPONENT RECIPES</small><strong>shadcn-svelte</strong><p>Optional source recipes only. Generated files become locally owned apparent components built on Bits UI.</p></div>
        <div><small>DATA VISUALIZATION</small><strong>LayerChart 2</strong><p>The single chart engine, used only behind local apparent chart components.</p></div>
        <div><small>VISUAL AUTHORITY</small><strong>apparent tokens</strong><p>Brand tokens and local CSS define color, type, space, geometry, hierarchy and motion.</p></div>
      </div>
      <div class="bb-callout"><strong>Keep the stack small</strong><p>Do not keep parallel Bits UI and shadcn-svelte versions of a component. Do not add another primitive library, chart engine, icon system or theme without a documented unmet requirement.</p></div>
      <h2>Component contract</h2>
      <p>Every shared component must document all of the following before approval.</p>
      <div class="bb-contract-grid">
        <div><b>Purpose</b><span>When to use it and when not to.</span></div>
        <div><b>Anatomy</b><span>Required labels, content and slots.</span></div>
        <div><b>Behavior</b><span>Mouse, touch, keyboard and focus order.</span></div>
        <div><b>States</b><span>Default, hover, focus, disabled, loading, empty, error, success, partial and retrying.</span></div>
        <div><b>Responsive</b><span>Reflow, long content, zoom and table overflow.</span></div>
        <div><b>Accessibility</b><span>Name, role, value, contrast and announcements.</span></div>
        <div><b>Privacy</b><span>What may enter URLs, logs, analytics and storage.</span></div>
        <div><b>Tests</b><span>Behavior, keyboard, browser, narrow viewport and visual regression.</span></div>
      </div>
      <h2>Architecture</h2>
      <ul><li>Use semantic HTML first. Add ARIA only where native semantics cannot express the interaction.</li><li>Use Bits UI as the single component-library dependency. Preserve its accessible behavior while applying apparent tokens.</li><li>Adopt a shadcn-svelte recipe only when it saves meaningful work. Review generated source for lost semantics, states, tokens and tests.</li><li>Keep LayerChart inside the shared chart directory. Feature routes consume apparent charts, not chart-engine examples.</li><li>Keep durable state on the server and use progressive enhancement for essential workflows where the product architecture allows it.</li><li>Long-running actions return a stable prefixed ULID and a status link immediately.</li></ul>
      <h2>Product-specific patterns</h2>
      <div class="bb-product-principles">
        <div><small>EVIDENCE</small><strong>Keep sources adjacent</strong><p>Document previews, extracted values and decisions remain traceable.</p></div>
        <div><small>FORMS</small><strong>Keep labels persistent</strong><p>Show inline validation and preserve submitted work after failure.</p></div>
        <div><small>TABLES</small><strong>Keep context attached</strong><p>Units, time window, named local zone, status and drill-down remain visible.</p></div>
        <div><small>SECURITY</small><strong>Keep private data out</strong><p>No document bodies, filenames or tenant data in URLs, telemetry or browser persistence.</p></div>
      </div>
      <h2>Implementation sources</h2>
      <p>The Svelte component-system specification is the current implementation architecture. The preserved Flask and Bootstrap portal is legacy evidence only; it does not define the stack for new apparent products.</p>
      <div class="bb-download-row"><a href="/brand/design-system/svelte-component-system.md">Svelte component system</a><a href="/brand/design-system/instructions/frontend-implementation.md">Frontend instructions</a><a href="/brand/design-system/product-interface.md">Product system</a><a href="/brand/design-system/tokens/apparent.css">CSS tokens</a><a href="/brand/design-system/reference/product-portal/README.md">Legacy portal evidence</a></div>
      <p class="bb-source-note">Implementation basis: <a href="https://bits-ui.com/docs">Bits UI</a>, <a href="https://www.shadcn-svelte.com/docs">shadcn-svelte</a>, <a href="https://www.layerchart.com/docs">LayerChart</a>, <a href="https://www.w3.org/TR/WCAG22/">WCAG 2.2</a> and <a href="https://designsystem.digital.gov/components/overview/">USWDS component guidance</a>.</p>
    `,
  },
  {
    title: 'Social media',
    summary: 'LinkedIn is the current primary social channel. Publish category insight before promotion.',
    body: `
      <div class="bb-spec-table">
        <div><small>STATIC FORMAT</small><p>1200 × 627 px. Keep critical content inside a 96 px safe area.</p></div>
        <div><small>PROFILE</small><p>Use the approved boxed “a” avatar and the full wordmark in banners.</p></div>
        <div><small>VIDEO</small><p>Always include captions. The first frame must work without playback.</p></div>
        <div><small>COPY</small><p>Lead with a useful category observation. Place the promotional claim second.</p></div>
        <div><small>PROOF</small><p>Attach sources and qualify estimates in the post or first comment.</p></div>
        <div><small>APPROVAL</small><p>Founder approval is required until a channel owner is assigned.</p></div>
      </div>
      <div class="bb-callout warning"><strong>Open</strong><p>Hashtag policy and the community-response playbook are not yet defined.</p></div>
      <h2>LinkedIn launch kit</h2>
      <div class="bb-download-row"><a download href="/brand/templates/linkedin/apparent-linkedin-company-cover.png">Download company cover</a><a download href="/brand/templates/linkedin/apparent-linkedin-company-logo.png">Download company logo</a><a download href="/brand/templates/linkedin/apparent-linkedin-founder-cover.png">Download founder cover</a><a href="/brand/templates/linkedin/linkedin-launch-kit.md">Open page copy and profile text</a></div>
    `,
  },
  {
    title: 'Templates',
    summary: 'Approved templates must be directly accessible here. Pending formats remain visibly unavailable until an editable source exists.',
    body: `
      <div class="bb-template-table">
        <a href="/brand/?slides=1#slide-1"><small>OPEN TEMPLATE</small><strong>Sales presentation</strong><p>16:9. One claim plus proof. Sources remain visible.</p><span>Open presentation</span></a>
        <a href="/brand/design-system/reference/product-portal/README.md"><small>OPEN TEMPLATE</small><strong>Product shell</strong><p>Evidence-first review interface with source files.</p><span>Open implementation</span></a>
        <a href="/brand/design-system/reference/product-portal/templates/documents/document_detail.html"><small>OPEN TEMPLATE</small><strong>Structured output</strong><p>Source evidence, processing state and stable identifiers.</p><span>Open HTML source</span></a>
        <div class="available"><small>DOWNLOAD TEMPLATE</small><strong>LinkedIn presence</strong><p>Company banner, founder banner, logo and approved profile copy.</p><span class="bb-template-actions"><a download href="/brand/templates/linkedin/apparent-linkedin-company-cover.png">Company cover</a><a download href="/brand/templates/linkedin/apparent-linkedin-founder-cover.png">Founder cover</a><a href="/brand/templates/linkedin/linkedin-launch-kit.md">Page copy</a></span></div>
        <div class="pending"><small>NEXT</small><strong>One-page document</strong><p>Not yet approved</p></div>
        <div class="pending"><small>NEXT</small><strong>Email signature</strong><p>Not yet approved</p></div>
      </div>
      <p>New templates require a recurring use case, a named owner, an editable source file and an approval path.</p>
    `,
  },
  {
    title: 'Design tokens',
    summary: 'Tokens are the machine-readable source for approved digital decisions.',
    body: `
      <div class="bb-code-grid">
        <pre><code>--color-paper: #F5F0E8;
--color-stock: #E7E0EE;
--color-carbon: #020102;
--color-lilac: #B7A5D8;
--color-signal: #7A58C7;</code></pre>
        <pre><code>--space-1: 8px;
--space-2: 16px;
--space-3: 24px;
--space-4: 32px;
--motion-fast: 120ms;</code></pre>
      </div>
      <div class="bb-spec-table">
        <div><small>CANONICAL</small><p><code>design-system/tokens/</code></p></div>
        <div><small>FORMATS</small><p>JSON and CSS</p></div>
        <div><small>NAMING</small><p>Use semantic role names, not visual guesses.</p></div>
        <div><small>PRECEDENCE</small><p>Safety → approved assets → tokens → implementations.</p></div>
      </div>
    `,
  },
  {
    title: 'Agent access',
    summary: 'Agents and LLMs use the same approved source as people. Stable text files and machine-readable tokens prevent visual scraping and guessed rules.',
    body: `
      <div class="bb-agent-map">
        <a href="/brand/llms.txt"><small>DISCOVER</small><strong>llms.txt</strong><p>Short index to the canonical sources.</p></a>
        <a href="/brand/llms-full.txt"><small>READ</small><strong>llms-full.txt</strong><p>Compact full-context brand reference.</p></a>
        <a href="/brand/brand-guidelines.md"><small>CITE</small><strong>brand-guidelines.md</strong><p>Human and machine-readable core rules.</p></a>
        <a href="/brand/design-system/tokens/apparent.tokens.json"><small>IMPLEMENT</small><strong>Token JSON</strong><p>Exact color, type, space and motion values.</p></a>
      </div>
      <h2>Agent rules</h2>
      <ol class="bb-writing-rules">
        <li><b>Start with discovery</b><p>Read <code>/brand/llms.txt</code>, then open only the sources required for the task.</p></li>
        <li><b>Prefer text over pixels</b><p>Use Markdown, JSON, CSS and SVG masters. Do not infer rules from screenshots.</p></li>
        <li><b>Preserve precedence</b><p>Safety and accessibility outrank brand styling. Canonical tokens outrank copied implementation values.</p></li>
        <li><b>Mark uncertainty</b><p>Do not fill unresolved decisions or invent assets, claims, evidence or additional functional status colors.</p></li>
      </ol>
      <div class="bb-callout"><strong>Convention status</strong><p><code>llms.txt</code> is an emerging proposal, not a universal crawler standard. It complements crawlable HTML, direct links and structured files. It does not replace them.</p></div>
      <p class="bb-source-note">Format basis: <a href="https://github.com/AnswerDotAI/llms-txt">the llms.txt proposal</a>. Crawlability remains governed separately by normal web and robots controls.</p>
    `,
  },
  {
    title: 'Governance',
    summary: 'The repository is the source of truth. Exceptions require approval and an expiry.',
    body: `
      <div class="bb-governance-table">
        <div><small>STATUS</small><strong>Brand guidelines v0.3 / review</strong></div>
        <div><small>OWNER</small><strong>Founder approval until a named brand owner is assigned</strong></div>
        <div><small>DEVIATIONS</small><strong>Record reason, owner and expiry before publishing</strong></div>
        <div><small>EXTERNAL TEAMS</small><strong>Share this live reference and approved assets at kickoff</strong></div>
        <div><small>ONBOARDING</small><strong>First-week walkthrough plus repository access</strong></div>
        <div><small>REVIEW</small><strong>Audit outputs and missing scenarios quarterly</strong></div>
      </div>
      <h2>Open decisions</h2>
      <ul><li>Print color specifications</li><li>Complete co-branding system</li><li>Final responsive type values</li></ul>
    `,
  },
  {
    title: 'Downloads',
    summary: 'Use approved masters directly. Do not redraw, trace or export a new version from screenshots.',
    body: `
      <div class="bb-download-list">
        <a href="${asset('brand/apparent-wordmark.svg')}"><span>SVG</span><strong>Primary wordmark</strong><small>Carbon on Lilac</small></a>
        <a href="${asset('brand/apparent-wordmark-inverse.svg')}"><span>SVG</span><strong>Inverse wordmark</strong><small>Lilac on Carbon</small></a>
        <a href="${asset('brand/apparent-icon.svg')}"><span>SVG</span><strong>Compact icon</strong><small>Primary</small></a>
        <a href="${asset('brand/apparent-icon-inverse.svg')}"><span>SVG</span><strong>Compact icon</strong><small>Inverse</small></a>
        <a download href="${asset('brand/apparent-icon.png')}"><span>PNG</span><strong>Compact icon</strong><small>Primary · 2048 × 2048</small></a>
        <a download href="${asset('brand/apparent-icon-inverse.png')}"><span>PNG</span><strong>Compact icon</strong><small>Inverse · 2048 × 2048</small></a>
        <a download href="/brand/templates/linkedin/apparent-linkedin-company-cover.png"><span>PNG</span><strong>LinkedIn company cover</strong><small>4200 × 700</small></a>
        <a download href="/brand/templates/linkedin/apparent-linkedin-founder-cover.png"><span>PNG</span><strong>LinkedIn founder cover</strong><small>1584 × 396</small></a>
      </div>
      <h2>Repository sources</h2>
      <div class="bb-path-list"><code>assets/brand/</code><code>design-system/tokens/</code><code>design-system/instructions/</code><code>design-system/product-interface.md</code><code>docs/design-process/</code></div>
      <h2>Agent-readable files</h2>
      <div class="bb-download-row"><a href="/brand/llms.txt">llms.txt</a><a href="/brand/llms-full.txt">Full text reference</a><a href="/brand/brand-guidelines.md">Guidelines Markdown</a><a href="/brand/design-system/tokens/apparent.tokens.json">Token JSON</a></div>
    `,
  },
];

export function renderBrandDocument(root) {
  document.body.classList.add('brand-reading-route');
  document.title = 'apparent | Brand guidelines';
  const markup = `
    <header class="bb-reader-header">
      <a class="bb-reader-brand" href="#guidelines-top"><img src="${asset('brand/apparent-wordmark.svg')}" alt="apparent"><span>Brand guidelines</span></a>
      <div><span>v0.3 · Review</span><a href="#templates">Templates</a><a href="?slides=1#slide-1">Brand presentation</a></div>
    </header>
    <div class="bb-reader-layout" id="guidelines-top">
      <aside class="bb-reader-sidebar">
        <p>Guidelines</p>
        <nav aria-label="Brand guideline sections">
          ${sections.map((item, index) => `<a href="#${item.title.toLowerCase().replaceAll(' ', '-')}"><span>${String(index + 1).padStart(2, '0')}</span>${item.title}</a>`).join('')}
        </nav>
      </aside>
      <main class="bb-reader-document">
        <header class="bb-guidelines-intro">
          <small>apparent / BRAND GUIDELINES</small>
          <h1>Brand guidelines</h1>
          <p>Approved standards for how apparent looks, speaks and behaves. Rules are mandatory unless a section is explicitly marked illustrative, pending or open.</p>
          <dl><div><dt>Version</dt><dd>0.3 / review</dd></div><div><dt>Updated</dt><dd>22.07.2026</dd></div><div><dt>Owner</dt><dd>Founder approval</dd></div></dl>
        </header>
        ${sections.map((item, index) => `
          <section id="${item.title.toLowerCase().replaceAll(' ', '-')}" class="bb-reader-section">
            <header><small>${String(index + 1).padStart(2, '0')} / ${String(sections.length).padStart(2, '0')}</small><h1>${item.title}</h1><p>${item.summary}</p></header>
            <div class="bb-reader-body">${item.body}</div>
          </section>
        `).join('')}
      </main>
    </div>
  `;
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  root.replaceChildren(...parsed.body.childNodes);
}
