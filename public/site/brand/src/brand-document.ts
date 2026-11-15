import frogs from '../../public/assets/brand-book/assets/frogs/collection.json';
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
    summary: 'Human expression, playful making, and a life beyond the screen.',
    body: `
<h3>Point. Talk. Draw.</h3>
<p>It’s the machine’s job to understand us, not our job to talk like a machine.</p>
<div class="bb-definition-grid">
<div><small>OUR BELIEF</small><strong>We believe work should be enjoyable and leave us free for late nights with friends.</strong></div>
<div><small>OUR CONVICTION</small><strong>Through fun, we make better products.</strong><p>Play gives us room to experiment, follow our taste, and try the peculiar idea.</p></div>
<div><small>OUR PURPOSE</small><strong>Remove the friction between human expression and computer understanding.</strong></div>
<div><small>TODAY</small><strong>Point. Talk. Draw.</strong><p>Record your screen, voice and marks. Hand the context to your coding agent. Let it show you what it made.</p></div>
</div>
<h3>Who we are here for</h3><p>Creative people who already have a coding agent set up, make personal projects for fun, and enjoy good design. They have their own taste. They do not need to be designers, know specialist vocabulary, or use a particular technology stack.</p>
<h3>What we are building toward</h3><p>A more human way to collaborate with computers, across media and senses. Speech, pointing, drawing, and screen context are how apparent starts today. The broader vision is a direction, not a claim that every medium or sense is supported.</p>
<h3>Why the time matters</h3><p>If you save two hours, spend one making your project even more delightful because you want to. Spend the other with friends, painting, or doing something else you love. Saved time is yours.</p>
<h3>Character</h3><div class="bb-rule-grid">
<article class="bb-rule "><small>PLAYFUL</small><p>Make room for experimentation and delight. Fun is part of making better things.</p></article>
<article class="bb-rule "><small>WEIRD</small><p>Be unmistakably yourself. Peculiar frogs and unexpected details are welcome.</p></article>
<article class="bb-rule "><small>HUMAN</small><p>Write as a friendly person. Never require people to speak in computer language.</p></article>
<article class="bb-rule "><small>EFFORTLESS</small><p>Let people join the play. Never make them dismiss it to finish a task.</p></article>
<article class="bb-rule "><small>DEPENDABLE</small><p>Be exact about capture, privacy, permissions, delivery and recovery.</p></article>
</div><h3>Name and handles</h3><p>Write <b>apparent</b> in lowercase. Keep the existing boxed wordmark and icon. Use <b>tryapparent</b> when a unique handle is required. The logo, palette and Host Grotesk stay unchanged.</p>`,
  },  {
    title: 'Logo',
    summary: 'The apparent logo system contains a primary wordmark and a compact brand icon. Use the supplied masters without cropping or rebuilding them.',
    body: `
      <h3>Brand icon</h3>
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
      <h3>Wordmark</h3>
      <div class="bb-logo-board">
        <figure class="light"><img src="${asset('brand/apparent-wordmark.svg')}" alt="Primary apparent wordmark"><figcaption>Primary / Carbon on Lilac</figcaption></figure>
        <figure class="dark"><img src="${asset('brand/apparent-wordmark-inverse.svg')}" alt="Inverse apparent wordmark"><figcaption>Inverse / Lilac on Carbon</figcaption></figure>
      </div>
      <p>The color box is part of the wordmark. Never remove it, crop it to the letters or recreate its padding with CSS.</p>
      <h3>Wordmark construction</h3>
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
      <h3>Usage</h3>
      <div class="bb-spec-table">
        <div><small>DEFAULT</small><p>Use the full wordmark whenever the name fits.</p></div>
        <div><small>COMPACT</small><p>Use the boxed “a” only for favicons, avatars and controls where the name cannot fit.</p></div>
        <div><small>CLEAR SPACE</small><p>Keep 0.5x around the complete color box, where x equals its height.</p></div>
        <div><small>MINIMUM</small><p>Wordmark: 120 px wide digital. Brand icon: 24 × 24 px digital.</p></div>
        <div><small>BACKGROUND</small><p>Use the primary or inverse boxed master. The box remains intact on every surface.</p></div>
        <div><small>FORMAT</small><p>SVG for digital. PNG only where SVG is unsupported. Print masters are not yet approved.</p></div>
      </div>
      <h3>Incorrect use</h3>
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
      <h3>Approved text pairings</h3>
      <div class="bb-contrast-list">
        <div><b>18.37:1</b><span>Carbon on Paper</span><small>AA / AAA</small></div>
        <div><b>4.57:1</b><span>Signal on Paper</span><small>AA</small></div>
        <div><b>9.31:1</b><span>Carbon on Lilac</span><small>AA / AAA</small></div>
        <div><b>4.57:1</b><span>Paper on Signal</span><small>AA</small></div>
      </div>
      <div class="bb-callout warning"><strong>Restricted</strong><p>Normal-size Signal text is allowed only on Paper. On Stock or Carbon, reserve Signal for non-text UI, focus, graphics, large text, or filled controls with Paper text. Signal and Lilac need a second non-color distinction.</p></div>
      <h3>Active decisions and optional interactions</h3><p>Signal identifies the active decision or action flow, including alternatives such as “Activate upload / Not today”. Use fill, border and wording for emphasis inside that group. Lilac identifies optional interactions outside the flow. Active does not mean checked; optional does not mean disabled.</p><p>Switch tracks use Signal when Off and lighter Lilac when On. Thumbs are Carbon in light mode and white in dark mode, with a Carbon edge for contrast. White is a thumb-only exception. Keep left Off/right On, no track outline and visible keyboard focus. Command-copy surfaces remain Lilac. Keep preference saves quiet, use a wait cursor while saving and the shared ErrorDialog popup for operational failures, commands visible with an embedded copy icon, and optional explanations accessible on hover, focus and click. Follow the <a href="/brand/design-system/desktop-settings.md">Desktop Settings specification</a> for exact geometry and dark mode.</p><p>Error dialogs use the failure color and icon, clear copy, optional update-style artwork, and left-aligned actions: primary recovery first, Close second. Focus recovery on open, support Escape and restore focus. Keep field validation beside its field.</p><h3>Functional status colors</h3>
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
      <div class="bb-type-specimen"><small>HOST GROTESK / 400 · 500 · 700</small><strong>Aa Bb Cc 0123456789</strong><p>Point. Talk. Draw.</p></div>
      <h3>Approved scale</h3>
      <div class="bb-type-table">
        <div><small>PRESENTATION</small><b>120 / 60 / 30</b><p>Hero, title and supporting copy.</p></div>
        <div><small>PRODUCT</small><b>48 / 24 / 18</b><p>Page title, section heading and body. Ratio 4:2:1.5; short metadata stays 16px.</p></div>
        <div><small>BODY COPY</small><b>18 / 27</b><p>55–75 characters per line.</p></div>
        <div><small>NUMERALS</small><b>Tabular</b><p>Always include unit, denominator and timeframe.</p></div>
      </div>
      <h3>Implementation</h3>
      <pre><code>font-family: "Host Grotesk", system-ui, sans-serif;
font-size: 48px | 24px | 18px;
font-weight: 400 | 500 | 700;</code></pre>
<div class="bb-type-hierarchy"><h3 class="bb-type-title">Agents</h3><h4 class="bb-type-section">Labs</h4><p>Choose how apparent works with your coding agent.</p></div>

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
    summary: 'Clear structure leaves room for expressive play.',
    body: `<p>Keep the existing 8px spacing system, aligned edges, Paper surfaces, and Carbon rules. Give prose a bounded reading width. Let artwork be expressive without making controls harder to find.</p><div class="bb-rule-grid"><article class="bb-rule "><small>MARKETING</small><p>Frogs, hand-drawn marks and optional surprises can carry personality. Keep the product action easy to understand.</p></article><article class="bb-rule "><small>PRODUCT</small><p>Capture and handoff stay immediate. Conventional controls belong mainly in Settings; the sharing and viewing workspace belongs in Connect.</p></article><article class="bb-rule "><small>MOTION</small><p>Use brief transitions for controls. Longer playful sequences must be optional, interruptible and respect reduced motion.</p></article><article class="bb-rule "><small>NO FRICTION</small><p>No mandatory jokes, surprise sound, obstructive animations or delays before the action.</p></article></div>`,
  },  {
    title: 'Highlighting',
    summary: 'Marks make a human intention visible.',
    body: `<div class="bb-highlight-demo"><p>Show your agent <mark>what you mean.</mark></p></div><p>The boxed wordmark keeps its highlighter character. In the capture product, marks point to what someone means: a region, an idea or a change.</p><p>Use Lilac for a selected region or meaningful emphasis, Signal for the primary action and focus, and the existing drawing pigments for user-authored marks. Circles, arrows and imperfect strokes can be expressive. Keep words legible and distinguish illustrative marks from real user input.</p>`,
  },  {
    title: 'Photography',
    summary: 'Show the pleasure of making and the life around it.',
    body: `<p>Use human, specific scenes: making something, sketching an idea, painting, or spending time with friends. The existing landing page is the reference for the relationship between expressive artwork and real life.</p><p>Frogs and imaginative illustration are welcome. Do not default to office stock photography, document archives, property portfolios, robots or generic AI glow. Use consented, licensed images and keep private captures out of public examples.</p>`,
  },  {title: 'Frog collection', summary: 'Original artwork to download, remix and use as a reference for new images.', body: `
<p>Our frogs are peculiar companions in the pleasure of making things. Keep the recognizable chunky pixels, olive bodies, cream bellies, big eyes, dark outlines and warm cheek accents. Their artwork colors are not new interface status colors.</p>
<div class="bb-frog-grid">${frogs.assets.map(item => `<figure><a class="bb-frog-preview" href="${item.url}" aria-label="Open ${item.name} original"><img src="${item.url}" alt="${item.name}" loading="lazy" width="${item.width}" height="${item.height}"></a><figcaption><h3>${item.name}</h3><p>${item.description}</p><p class="bb-asset-meta">PNG · ${item.width} × ${item.height}</p><a download href="${item.url}">Download ${item.name.toLowerCase()}</a></figcaption></figure>`).join('')}</div>
<h3>Make another frog</h3><p>Download the closest pose and attach the original as an image reference. Describe the new action, expression, framing and background. Preserve the character rather than tracing a screenshot. Inspect the result beside the original before adopting it. Some scenes include a painted background; inspect the PNG before compositing.</p><details><summary>Reference prompt for new artwork</summary><pre><code>${frogs.referencePrompt}</code></pre></details><p>New generations are candidates, not automatically canonical assets. Avoid smooth vectors, glossy 3D, photorealism and a generic new mascot. Keep labels and logos outside generated artwork.</p><div class="bb-download-row"><a download href="/brand/assets/frogs/collection.json">Download asset index and prompt</a></div>`},
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
      <div class="bb-callout warning"><strong>Illustration and icons</strong><p>Use the frog collection for expressive illustration. Product action icons still need consistent geometry and accessible labels.</p></div>
    `,
  },
  {
    title: 'Voice and tone',
    summary: 'Warm, wonderfully weird, and easy to understand.',
    body: `<div class="bb-voice-table"><div><small>MARKETING</small><strong>Invite people to play</strong><p>Be expressive, curious and a little odd. Celebrate what people want to make.</p></div><div><small>PRODUCT</small><strong>Make the next action obvious</strong><p>Use familiar words and direct verbs. Keep capture and handoff free of compulsory entertainment.</p></div><div><small>ERRORS + PERMISSIONS</small><strong>Be calm and literal</strong><p>Name what happened, what is saved, and what to do next. No jokes at someone’s expense.</p></div><div><small>TECHNICAL</small><strong>Stay exact</strong><p>Name actual inputs, outputs and limits. A copied link does not mean a video is ready to watch.</p></div></div><h3>The test</h3><p>A frog you choose to make jump fits. A joke you must dismiss before recording does not. Care deeply about what people make without making the act of working solemn.</p>`,
  },  {
    title: 'Writing',
    summary: 'Sound like a person inviting another person to make something.',
    body: `<h3>Say what you mean</h3><p>Use short, concrete words: point, talk, draw, show, make, play. Speak to people with taste and ideas, without assuming professional design or coding knowledge.</p><div class="bb-copy-pairs"><div class="positive"><small>USE</small><p>Point. Talk. Draw.</p><p>Show your agent what you mean.</p><p>What if the frog could jump?</p></div><div class="negative"><small>AVOID</small><p>AI-ready operational data.</p><p>Maximize your creative output.</p><p>Revolutionary AI magic.</p></div></div><h3>Keep personality and clarity together</h3><p>Sentence case and the lowercase apparent name remain. Contractions and an occasional exclamation are welcome when they sound natural. Do not force a joke into every label, invent performance claims, or use decorative type that impairs reading. Keep the existing no-em-dash convention.</p><h3>When something goes wrong</h3><p>Say “Upload failed. Your recording is saved on this computer. Try uploading again.” Do not say “Oops, the frog ate your recording.” Preserve the distinction between local capture, copying, uploading, and being ready to watch.</p><h3>Instruction for writing tools</h3><pre><code>Write for apparent: warm, playful, peculiar, and clear.
Our audience makes personal projects with coding agents for fun.
Good design does not require specialist vocabulary.
It is the machine’s job to understand us.
Use Point. Talk. Draw. as the product line.
Keep instructions, permissions and errors literal and useful.
Do not promise unsupported capabilities or invent evidence.</code></pre>`,
  },  {
    title: 'Data visualization',
    summary: 'Charts must make the relationship and the evidence status auditable.',
    body: `
      <div class="bb-data-example">
        <header><small>ILLUSTRATIVE EXPORT COUNTS / LAST 30 DAYS</small><span>Illustrative</span></header>
        <div><label>Requested</label><i style="--w:100%"></i><b>52,940</b></div>
        <div><label>Prepared</label><i style="--w:83%"></i><b>43,820</b></div>
        <div><label>Ready</label><i style="--w:82%"></i><b>43,624</b></div>
        <footer>Illustrative example dataset · refreshed 15.11.2026, 09:42 CEST</footer>
      </div>
      <h3>Required anatomy</h3>
      <ol class="bb-numbered-rules"><li><b>Metric</b><span>Name the measure and denominator.</span></li><li><b>Time</b><span>State the window and named local zone.</span></li><li><b>Source</b><span>Name the source and refresh time.</span></li><li><b>Status</b><span>Mark actual, estimate, forecast or illustrative.</span></li><li><b>Uncertainty</b><span>Show thresholds and incomplete intervals.</span></li></ol>
      <h3>Approved chart grammar</h3>
      <div class="bb-product-principles">
        <div><small>COMPARISON</small><strong>Aligned bars or dots</strong><p>Use a shared baseline and place the exact value beside each mark.</p></div>
        <div><small>TREND</small><strong>Time series</strong><p>Label the time range, named local zone, units, refresh time and incomplete intervals.</p></div>
        <div><small>UNCERTAINTY</small><strong>Range or threshold</strong><p>Show assumptions, limits and review consequences with text plus pattern or line style.</p></div>
        <div><small>PROCESS</small><strong>Stages or funnel</strong><p>Name the denominator at every stage and preserve a path to the underlying evidence.</p></div>
      </div>
      <h3>Implementation system</h3>
      <div class="bb-spec-table">
        <div><small>ENGINE</small><strong>Owning product</strong><p>Reuse its existing chart implementation behind local components.</p></div>
        <div><small>RECIPE</small><strong>Local components</strong><p>Use the current React stack and brand tokens. Do not import a legacy chart framework for a specimen.</p></div>
        <div><small>PRODUCT API</small><strong>apparent chart components</strong><p>Feature routes consume named comparison, trend, range, process and qualified-metric components.</p></div>
        <div><small>VISUAL AUTHORITY</small><strong>apparent tokens</strong><p>Carbon sets baselines, Lilac comparison structure and Signal one selected series or threshold.</p></div>
      </div>
      <h3>Accessible delivery</h3>
      <div class="bb-rule-grid">
        ${rule('DIRECT LABELS', 'Place series names and exact values beside their marks wherever space allows.', 'positive')}
        ${rule('TOOLTIP', 'Use a tooltip for added detail only. It must not contain the only value, label, source or qualification.')}
        ${rule('TEXT AND TABLE', 'Provide a concise summary and an accessible table or equivalent data view.', 'positive')}
        ${rule('RESPONSIVE', 'Recompose at narrow widths without removing evidence or requiring horizontal reading.')}
      </div>
      <h3>Color and scale</h3>
      <p>Use direct labels, truthful proportions, aligned position or length and shared baselines. Pair every color distinction with text, dash, pattern, outline or another non-color cue.</p>
      <div class="bb-callout"><strong>Core plus pattern</strong><p>Add no categorical hues. Use Signal solid for one selected series, Lilac and Carbon for comparisons, then repeat Lilac and Carbon only with direct labels plus distinct dash, pattern or outline. Keep at most five visible series; beyond that, filter, group, use small multiples or provide a table.</p></div>
      <h3>Do not use</h3>
      <p>Do not use decorative 3D treatments, decorative or value-encoding gradients, unlabeled axes, color-matching legends or library-default palettes. CSS gradient functions may render approved hatch or dot patterns only. Avoid dual axes and radial charts when aligned position or length communicates the relationship more accurately. Prefer SVG or semantic HTML; Canvas requires an equivalent accessible summary and data view.</p>
      <div class="bb-download-row"><a href="#frontend-design-system">Chart implementation system</a><a href="/brand/design-system/product-interface.md#metrics-tables-and-charts">Product chart rules</a><a href="/brand/design-system/tokens/apparent.css">CSS tokens</a></div>
    `,
  },
  {
    title: 'Identifiers',
    summary: 'Use prefixed ULIDs as the single canonical identifier format for documents, runs and other durable product objects.',
    body: `
      <div class="bb-identifier-hero"><small>CANONICAL EXAMPLE</small><code>run_01JQ7M6J8H9T2R4K5N6P7Q8S9T</code><p>A short lowercase type prefix, one underscore and a 26-character uppercase ULID.</p></div>
      <h3>Approved prefixes</h3>
      <div class="bb-spec-table">
        <div><small>DOCUMENT</small><p><code>doc_</code> for one source document.</p></div>
        <div><small>RUN</small><p><code>run_</code> for one processing attempt.</p></div>
        <div><small>BATCH</small><p><code>bat_</code> for a submitted group.</p></div>
        <div><small>REVIEW</small><p><code>rev_</code> for one durable review decision.</p></div>
        <div><small>OUTPUT</small><p><code>out_</code> for one structured output.</p></div>
      </div>
      <h3>System rules</h3>
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
    summary: 'Playfulness is an invitation. The workflow stays effortless.',
    body: `<div class="bb-product-principles"><div><strong>Expression first</strong><p>Help someone point, talk and draw without learning a new technical language.</p></div><div><strong>Instant essentials</strong><p>Keep recording, stopping and handing off direct. Optional delight never blocks them.</p></div><div><strong>Truthful status</strong><p>Distinguish saved locally, copied, uploading, shared and ready to watch.</p></div><div><strong>Recoverable failure</strong><p>Preserve work, state the problem and offer a clear next action.</p></div></div><p>Use the actual shared React/shadcn controls below. Follow the adopted <a href="/brand/design-system/desktop-settings.md">Desktop Settings specification</a> for Settings. This brand update does not change platform permissions or product behavior.</p>`,
  },  {
    title: 'Frontend design system',
    summary: 'A live component reference built from the same shared React sources as the products.',
    body: `<p>Desktop and Connect use React/TypeScript with canonical controls in <code>shared/ui</code>. Public uses React; this reading page retains its existing TypeScript document shell. Use the owning product’s stack. Historical Svelte and portal material is legacy reference, not the current implementation prescription.</p><div id="brand-components"></div><h3>Component contracts</h3><p>Each component needs a persistent label, keyboard and focus behavior, responsive layout, and truthful default, selected, disabled, waiting, empty, error and recovery states where relevant. Use the existing tokens and product theme. This gallery applies the preserved brand palette without changing other product themes.</p><div class="bb-download-row"><a href="https://github.com/tryapparent/apparent/tree/main/shared/ui">Shared component source</a><a href="/brand/design-system/instructions/frontend-implementation.md">Implementation guidance</a><a href="/brand/design-system/desktop-settings.md">Desktop Settings</a></div>`,
  },  {
    title: 'Social media',
    summary: 'Share the pleasure of making something peculiar.',
    body: `<p>Show personal projects, playful experiments, drawings and what someone made with their agent. Use real capture when demonstrating the product; label illustrative scenes. Keep claims truthful, videos captioned and private material out of public posts.</p><p>The old document-product LinkedIn banners and copy are historical assets, not templates for this direction. Start with the current wordmark and the frog collection.</p>`,
  },  {
    title: 'Templates',
    summary: 'Start with the current identity and reusable materials.',
    body: `<div class="bb-download-row"><a href="/brand/?slides=1#slide-1">Brand presentation</a><a href="#frog-collection">Frog collection</a><a href="#frontend-design-system">Component library</a><a href="/brand/brand-guidelines.md">Writing and identity reference</a></div><p>Build new images from the original frog references. Keep logo and text as real supplied assets or live type rather than generated lettering.</p>`,
  },  {
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
      <h3>Agent rules</h3>
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
        <div><small>STATUS</small><strong>Brand guidelines v0.5 / capture</strong></div>
        <div><small>OWNER</small><strong>Founder approval until a named brand owner is assigned</strong></div>
        <div><small>DEVIATIONS</small><strong>Record reason, owner and expiry before publishing</strong></div>
        <div><small>EXTERNAL TEAMS</small><strong>Share this live reference and approved assets at kickoff</strong></div>
        <div><small>ONBOARDING</small><strong>First-week walkthrough plus repository access</strong></div>
        <div><small>REVIEW</small><strong>Audit outputs and missing scenarios quarterly</strong></div>
      </div>
      <h3>Open decisions</h3>
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
      </div>
      <h3>Repository sources</h3>
      <div class="bb-path-list"><code>assets/brand/</code><code>design-system/tokens/</code><code>design-system/instructions/</code><code>design-system/product-interface.md</code><code>docs/design-process/</code></div>
      <h3>Agent-readable files</h3>
      <div class="bb-download-row"><a href="/brand/llms.txt">llms.txt</a><a href="/brand/llms-full.txt">Full text reference</a><a href="/brand/brand-guidelines.md">Guidelines Markdown</a><a href="/brand/design-system/tokens/apparent.tokens.json">Token JSON</a></div>
    `,
  },
];

export function renderBrandDocument(root) {
  document.body.classList.add('brand-reading-route');
  document.title = 'apparent | Brand guidelines';
  const markup = `
    <a class="bb-skip" href="#brand-content">Skip to content</a>
    <header class="bb-reader-header">
      <a class="bb-reader-brand" href="#guidelines-top"><img src="${asset('brand/apparent-wordmark.svg')}" alt="apparent"><span>Brand guidelines</span></a>
      <div><span>v0.5 · Capture</span><a href="#frog-collection">Frogs</a><a href="#frontend-design-system">Components</a><a href="?slides=1#slide-1">Brand presentation</a></div>
    </header>
    <div class="bb-reader-layout" id="guidelines-top">
      <aside class="bb-reader-sidebar">
        <p>Guidelines</p>
        <nav aria-label="Brand guideline sections">
          ${sections.map((item, index) => `<a href="#${item.title.toLowerCase().replaceAll(' ', '-')}"><span>${String(index + 1).padStart(2, '0')}</span>${item.title}</a>`).join('')}
        </nav>
      </aside>
      <div class="bb-reader-document" id="brand-content" tabindex="-1">
        <header class="bb-guidelines-intro">
          <small>apparent / BRAND GUIDELINES</small>
          <h1>Brand guidelines</h1>
          <p>Point. Talk. Draw. A practical kit for a more human, playful way to make things with computers.</p>
          <dl><div><dt>Version</dt><dd>0.4 / capture</dd></div><div><dt>Updated</dt><dd>16.11.2026</dd></div><div><dt>Owner</dt><dd>Founder approval</dd></div></dl>
        </header>
        ${sections.map((item, index) => `
          <section id="${item.title.toLowerCase().replaceAll(' ', '-')}" class="bb-reader-section">
            <header><small>${String(index + 1).padStart(2, '0')} / ${String(sections.length).padStart(2, '0')}</small><h2>${item.title}</h2><p>${item.summary}</p></header>
            <div class="bb-reader-body">${item.body}</div>
          </section>
        `).join('')}
      </div>
    </div>
  `;
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  root.replaceChildren(...parsed.body.childNodes);
}
