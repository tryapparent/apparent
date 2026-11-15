import { createNativeSlide } from './components/native-slide.ts';

const TOTAL_SLIDES = 15;
const BRAND_ASSET = '/brand/assets/brand';
const PHOTO_ASSET = '/brand/assets/photos';

function brandSlide(title, className, page, section, markup) {
  const slide = createNativeSlide({
    title,
    className: `brand-slide apparent-brand-slide bb-v2 ${className}`,
    markup: `
      <div class="bb-chrome" aria-hidden="true">
        <span>apparent / ${section}</span>
        <span>${String(page).padStart(2, '0')} / ${TOTAL_SLIDES}</span>
      </div>
      ${markup}
    `,
  });
  slide.dataset.expectedFont = 'Host Grotesk';
  return slide;
}

const wordmark = (variant = 'primary', className = '') => `
  <img class="bb-wordmark ${className}" src="${BRAND_ASSET}/apparent-wordmark${variant === 'inverse' ? '-inverse' : ''}.svg" alt="apparent">
`;

const iconPath = 'M211 -12Q155 -12 114.5 8Q74 28 53 62Q32 96 32 137Q32 215 88 257.5Q144 300 235 300Q278 300 309 294Q340 288 360 281L360 305Q360 357 330.5 381Q301 405 254 405Q221 405 195 391.5Q169 378 162 344L39 344Q45 397 75 433.5Q105 470 151.5 489Q198 508 254 508Q365 508 427.5 455Q490 402 490 305L490 193Q490 155 494.5 137Q499 119 509 114Q519 109 536 109L540 109L540 0L512 0Q459 0 424 14Q389 28 373 69Q348 34 307 11Q266 -12 211 -12ZM240 87Q272 87 294.5 101.5Q317 116 332 141.5Q347 167 353 197Q332 203 304.5 208.5Q277 214 249 214Q210 214 186.5 196.5Q163 179 163 148Q163 121 183.5 104Q204 87 240 87Z';
const icon = (className = '') => `<span class="apparent-icon ${className}" aria-label="apparent icon"><span class="apparent-icon-label" aria-hidden="true">a</span><svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" fill="var(--icon-bg)"/><path fill="var(--icon-fg)" transform="translate(50.08 434.56) scale(.72 -.72)" d="${iconPath}"/></svg></span>`;

export function renderBrandCover() {
  return brandSlide('apparent brand book', 'bb-cover', 1, 'BRAND CORE / 2026', `
    <div class="bb-cover-id">${wordmark()}</div>
    <section class="bb-cover-copy">
      <p class="bb-eyebrow">AI-READY OPERATIONAL DATA</p>
      <h1>Documents<br><span>ready</span> for AI.</h1>
      <p>apparent turns unstructured operational knowledge into data people, software and AI can build on.</p>
    </section>
    <section class="bb-transform" aria-label="Unstructured documents cross a Signal threshold and become structured operational fields">
      <div class="bb-source-stack" aria-hidden="true"><i></i><i></i><i></i><b>UNSTRUCTURED<br>KNOWLEDGE</b></div>
      <div class="bb-threshold"><span>apparent</span></div>
      <div class="bb-field-stack">
        <div><small>ENTITY</small><strong>LEASE-0284</strong></div>
        <div><small>COMMENCEMENT</small><strong>01 SEP 2026</strong></div>
        <div><small>CONFIDENCE</small><strong>98%</strong></div>
      </div>
    </section>
  `);
}

export function renderBrandIdea() {
  return brandSlide('The brand idea', 'bb-idea', 2, 'FOUNDATION', `
    <section class="bb-idea-copy">
      <p class="bb-eyebrow">THE CENTRAL IDEA</p>
      <h1>Operational data is the foundation of an <span>AI-native company.</span></h1>
      <p>AI can only accelerate operations when the knowledge beneath it is structured, trustworthy and usable.</p>
    </section>
    <section class="bb-foundation-stack" aria-label="Three-layer foundation from unstructured sources to AI-native operations">
      <div class="bb-layer bb-layer-top"><span>03</span><strong>AI-NATIVE OPERATIONS</strong><small>Automation · decisions · scale</small></div>
      <div class="bb-layer bb-layer-core"><span>02</span><strong>TRUSTED OPERATIONAL DATA</strong><small>Structured · traceable · usable</small></div>
      <div class="bb-layer bb-layer-base"><span>01</span><strong>UNSTRUCTURED SOURCES</strong><small>Documents · archives · inherited knowledge</small></div>
    </section>
  `);
}

export function renderCustomerJourney() {
  return brandSlide('The customer journey', 'bb-journey', 3, 'FOUNDATION', `
    <header class="bb-title-row">
      <div><p class="bb-eyebrow">THE PURCHASE MOMENT</p><h1>Ambition meets the data bottleneck.</h1></div>
      <p>apparent removes the constraint without removing control.</p>
    </header>
    <section class="bb-journey-track">
      <div class="bb-journey-line" aria-hidden="true"></div>
      <article><span>01</span><small>AMBITION</small><h2>Become<br>AI-native.</h2><p>Accelerate operations with AI.</p></article>
      <article class="is-bottleneck"><span>02</span><small>BOTTLENECK</small><h2>Knowledge is<br>trapped.</h2><p>Essential data remains unstructured.</p></article>
      <article class="is-threshold"><span>03</span><small>apparent</small><h2>Make it<br>operational.</h2><p>Structure, validate and retain evidence.</p></article>
      <article><span>04</span><small>OUTCOME</small><h2>Move faster.<br>Stay in control.</h2><p>People, software and AI use the same foundation.</p></article>
    </section>
  `);
}

export function renderPositioning() {
  return brandSlide('Positioning hierarchy', 'bb-positioning', 4, 'STRATEGY', `
    <section class="bb-position-lead">
      <p class="bb-eyebrow">THE MARKET SPACE</p>
      <h1>AI-ready<br><span>operational data.</span></h1>
      <p>Documents are the present entry point, not the permanent boundary of the company.</p>
    </section>
    <section class="bb-position-stack">
      <div><small>COMPANY</small><strong>The operational-data platform for AI-native companies.</strong></div>
      <div><small>ENDURING PROMISE</small><strong>Operational data you can build on.</strong></div>
      <div><small>PRODUCT PROPOSITION</small><strong>Documents <em>ready</em> for AI.</strong></div>
      <div><small>EMOTIONAL BENEFIT</small><strong>Move faster without losing control.</strong></div>
    </section>
  `);
}

export function renderCharacter() {
  const traits = [
    ['LEAN', 'SPARSE OR UNFINISHED', '18'],
    ['FAST', 'RECKLESS', '24'],
    ['TECHNICAL', 'OBSCURE', '28'],
    ['ASSURED', 'CORPORATE', '22'],
    ['PRECISE', 'BUREAUCRATIC', '20'],
  ];
  return brandSlide('Brand character', 'bb-character', 5, 'STRATEGY', `
    <header class="bb-character-head">
      <p class="bb-eyebrow">THE DESIRED TENSION</p>
      <h1>Startup speed.<br><span>Scale-up confidence.</span></h1>
    </header>
    <section class="bb-traits">
      ${traits.map(([good, bad, position]) => `<div class="bb-trait"><strong>${good}</strong><i><b style="--position:${position}%"></b></i><span>NOT ${bad}</span></div>`).join('')}
    </section>
    <blockquote>“We can move much faster<br>without losing control.”</blockquote>
  `);
}

export function renderMessaging() {
  return brandSlide('Messaging system', 'bb-messaging', 6, 'VOICE', `
    <header class="bb-title-row bb-title-row-compact">
      <div><p class="bb-eyebrow">MESSAGE HIERARCHY</p><h1>Lead with the bottleneck.<br><span>Land on acceleration.</span></h1></div>
      <p>AI is the ambition. Trusted operational data is what makes it possible.</p>
    </header>
    <section class="bb-message-map">
      <div class="bb-message-core"><small>01 / PROMISE</small><strong>Operational data you can build on.</strong></div>
      <div><small>02 / PROBLEM</small><strong>Critical knowledge is trapped in unstructured sources.</strong></div>
      <div><small>03 / ACTION</small><strong>Structure it. Validate it. Keep the evidence attached.</strong></div>
      <div><small>04 / OUTCOME</small><strong>Automate and scale without losing control.</strong></div>
    </section>
    <section class="bb-proof-behaviors">
      <article><span>TRACEABLE</span><p>Keep each field connected to its source.</p></article>
      <article><span>EXPLICIT</span><p>Show confidence, uncertainty and human decisions.</p></article>
      <article><span>OPERATIONAL</span><p>Write about work completed, not AI theatre.</p></article>
    </section>
    <footer class="bb-say-avoid"><div><small>SAY</small><strong>Ready to automate.</strong></div><div><small>AVOID</small><strong>Magic. Effortless. Revolutionary.</strong></div></footer>
  `);
}

export function renderLogoSystem() {
  return brandSlide('Logo and icon system', 'bb-logo', 7, 'IDENTITY', `
    <header class="bb-logo-lead">
      <p class="bb-eyebrow">PRIMARY IDENTIFIER</p>
      <h1>Use the full wordmark.</h1>
      <p>The boxed <strong>a</strong> is reserved for compact contexts where the name cannot fit.</p>
    </header>
    <section class="bb-logo-primary">${wordmark('primary')}</section>
    <section class="bb-logo-specs">
      <article class="bb-logo-inverse"><small>INVERSE / CARBON FIELD</small>${wordmark('inverse')}</article>
      <article class="bb-clearspace"><small>CLEAR SPACE / 1×</small><div><i></i>${wordmark('primary')}</div></article>
      <article class="bb-compact"><small>COMPACT EXCEPTION</small><div>${icon()}<p>Favicon<br>app icon<br>tight avatar</p></div></article>
      <article class="bb-logo-misuse"><small>NEVER</small><p>Stretch · recolor · add effects<br>rebuild with live type · lead with icon</p></article>
    </section>
  `);
}

export function renderColorSystem() {
  return brandSlide('Color and accessibility', 'bb-color', 8, 'FOUNDATIONS', `
    <header class="bb-title-row bb-title-row-compact">
      <div><p class="bb-eyebrow">COLOR ROLES</p><h1>Five colors.<br><span>One decisive Signal.</span></h1></div>
      <p>Choose color by job and context. There is no universal allocation ratio.</p>
    </header>
    <section class="bb-color-roles">
      <article class="paper"><small>PAPER</small><strong>#F5F0E8</strong><p>Reading surface</p></article>
      <article class="stock"><small>STOCK</small><strong>#E7E0EE</strong><p>Grouped structure</p></article>
      <article class="carbon"><small>CARBON</small><strong>#020102</strong><p>Ink + inverse field</p></article>
      <article class="lilac"><small>LILAC</small><strong>#B7A5D8</strong><p>Selection + depth</p></article>
      <article class="signal"><small>SIGNAL</small><strong>#7A58C7</strong><p>One action or transition</p></article>
    </section>
    <section class="bb-pairings">
      <div><small>APPROVED TEXT PAIRINGS</small><p><b>18.37</b> Carbon / Paper</p><p><b>4.57</b> Signal / Paper</p><p><b>9.31</b> Carbon / Lilac</p><p><b>4.57</b> Paper / Signal</p></div>
      <div class="bb-prohibited"><small>RESTRICTED</small><p>Signal text only on Paper</p><span>On Stock or Carbon: UI, focus, graphics, large text, or filled controls only</span></div>
      <div><small>PRODUCT RULE</small><p>Signal and Lilac need a second non-color cue.</p><span>Use 45% Carbon only for disabled controls, never informative text.</span></div>
    </section>
  `);
}

export function renderTypography() {
  return brandSlide('Typography', 'bb-type', 9, 'FOUNDATIONS', `
    <section class="bb-type-editorial">
      <p class="bb-eyebrow">HOST GROTESK / 400 · 500 · 700</p>
      <h1>Operational data<br><span>you can build on.</span></h1>
      <p class="bb-type-body">apparent turns documents and inherited operational knowledge into structured, trustworthy data that people, software and AI can use.</p>
      <div class="bb-type-glyphs" aria-label="Host Grotesk lowercase alphabet and numerals">abcdefghijklmnopqrstuvwxyz<br>0123456789</div>
    </section>
    <section class="bb-type-product">
      <div class="bb-product-head"><span>PRIORITY PROCESSING</span><strong>Run APP-02491</strong><small>Updated 12 min ago</small></div>
      <div class="bb-product-metric"><small>DOCUMENTS STRUCTURED</small><strong>43,820</strong><span>of 52,940 received</span></div>
      <div class="bb-product-row"><span>Classification review</span><b>184 waiting</b></div>
      <div class="bb-product-row"><span>Source access</span><b>Retrying · 12</b></div>
      <div class="bb-product-row"><span>Ready for delivery</span><b>43,624</b></div>
    </section>
    <footer class="bb-type-tokens">
      <div><small>PRESENTATION</small><span>120 / 60 / 30</span></div>
      <div><small>PRODUCT</small><span>36 / 18 / 16</span></div>
      <div><small>BODY</small><span>55–75 characters · 1.5 line height</span></div>
      <div><small>NUMBERS</small><span>Tabular · units + timeframe</span></div>
    </footer>
  `);
}

export function renderLayoutSystem() {
  return brandSlide('Layout and motion', 'bb-layout', 10, 'FOUNDATIONS', `
    <header class="bb-layout-head"><p class="bb-eyebrow">LAYOUT + MOTION</p><h1>Evidence beside the decision.</h1><p>One grid. Different formats. Movement only when state changes.</p></header>
    <section class="bb-format-grid">
      <article class="bb-format bb-format-web"><small>WEB / 12 COLUMNS</small><div class="bb-grid-overlay"></div><h2>Claim</h2><p>Proof stays in the same frame.</p><b></b></article>
      <article class="bb-format bb-format-product"><small>PRODUCT / 7:5 SPLIT</small><aside>EVIDENCE</aside><main><span>DECISION</span><i></i><i></i><button type="button" tabindex="-1">Confirm</button></main></article>
      <article class="bb-format bb-format-doc"><small>DOCUMENT / 8 PX SYSTEM</small><div><span>SOURCE</span><strong>Structured output</strong><p>Field value<br>confidence<br>source page</p></div></article>
    </section>
    <footer class="bb-motion-rule"><strong><span></span> INPUT</strong><i></i><strong class="is-active"><span></span> VALIDATED</strong><i></i><strong><span></span> OPERATIONAL</strong><p>120–200 ms · ease-out · reduced-motion alternative · never animate fake progress</p></footer>
  `);
}

export function renderImagerySystem() {
  return brandSlide('Imagery', 'bb-imagery', 11, 'EXPRESSION', `
    <header class="bb-imagery-head"><p class="bb-eyebrow">IMAGERY</p><h1>Show the work.<br><span>Then show the change.</span></h1><p>Evidence, operating context and human decisions outrank generic technology imagery.</p></header>
    <section class="bb-image-story">
      <figure class="bb-image-source"><img src="${PHOTO_ASSET}/status-archive-md-jawadur-rahman-pexels.jpg" alt="Archived physical documents"><figcaption><b>01 / EVIDENCE</b><span>Close enough to see material, condition and provenance.</span></figcaption></figure>
      <figure class="bb-image-context"><img src="${PHOTO_ASSET}/sam-industrial-park-wikimedia.jpg" alt="Industrial operating environment"><figcaption><b>02 / CONTEXT</b><span>Show where the knowledge affects real operations.</span></figcaption></figure>
      <figure class="bb-image-transition"><img src="${PHOTO_ASSET}/som-berlin-facade-pexels.jpg" alt="Building facade crossing from monochrome to Signal"><figcaption><b>03 / TRANSITION</b><span>Signal marks a real boundary or state change.</span></figcaption></figure>
    </section>
    <footer class="bb-image-rules"><div><small>DO</small><p>Documents · operators · decisions · resolved action</p></div><div><small>DO NOT</small><p>Robots · AI glow · code rain · anonymous corporate scale</p></div><div><small>SAFE USE</small><p>Redact private data · confirm permission · record source + license</p></div></footer>
  `);
}

export function renderDataSystem() {
  return brandSlide('Data visualization', 'bb-data', 12, 'EXPRESSION', `
    <header class="bb-data-head"><p class="bb-eyebrow">DATA VISUALIZATION</p><h1>Make every relationship<br><span>auditable.</span></h1><p>Illustrative example. Not customer evidence.</p></header>
    <section class="bb-data-grid">
      <article class="bb-throughput"><small>DOCUMENT THROUGHPUT / LAST 30 DAYS</small><div><span>Received</span><i style="--w:100%"></i><b>52,940</b></div><div><span>Structured</span><i style="--w:83%"></i><b>43,820</b></div><div><span>Ready</span><i style="--w:82%"></i><b>43,624</b></div><footer>Direct labels · shared baseline · absolute values</footer></article>
      <article class="bb-confidence"><small>FIELD CONFIDENCE / 43,820 DOCUMENTS</small><div><span>≥ 98%</span><i style="--w:68%"></i><b>68%</b></div><div><span>90–97%</span><i style="--w:24%"></i><b>24%</b></div><div><span>Review</span><i style="--w:8%"></i><b>8%</b></div><footer>Core hues · pattern + text redundancy</footer></article>
      <aside class="bb-data-anatomy"><small>QUALIFICATION ANATOMY</small><ol><li><b>WHAT</b> metric + denominator</li><li><b>WHEN</b> window + local zone</li><li><b>WHERE</b> source + refresh time</li><li><b>STATUS</b> actual, estimate or illustrative</li><li><b>UNCERTAINTY</b> threshold + incomplete interval</li></ol></aside>
    </section>
    <footer class="bb-data-source">Source: illustrative operational dataset · refreshed 21.07.2026, 09:42 CEST · no added chart hues · values are not customer results</footer>
  `);
}

export function renderApplications() {
  return brandSlide('Applications', 'bb-applications', 13, 'APPLICATIONS', `
    <header class="bb-app-head"><p class="bb-eyebrow">ONE BEHAVIOR / THREE SURFACES</p><h1>From proposition to decision.</h1><p>Real structure, restrained Signal and evidence attached to action.</p></header>
    <section class="bb-application-grid">
      <article class="bb-web-app"><small>WEBSITE</small>${wordmark()}<h2>Documents<br><em>ready</em> for AI.</h2><p>Turn inherited knowledge into operational data.</p><button type="button" tabindex="-1">See how it works</button></article>
      <article class="bb-product-app"><small>PRODUCT / REVIEW</small><header>${icon()}<strong>Classification review</strong><span>184 waiting</span></header><div class="bb-review-columns"><section><small>SOURCE EVIDENCE</small><p>Lease commencement is defined on page 12.</p><b>View page 12 →</b></section><section><small>DECISION</small><label>Commencement date</label><strong>01.09.2026</strong><button type="button" tabindex="-1">Confirm field</button></section></div></article>
      <article class="bb-output-app"><small>STRUCTURED OUTPUT</small><div>${wordmark('inverse')}<span>VERIFIED FIELD</span></div><dl><dt>LEASE COMMENCEMENT</dt><dd>01.09.2026</dd><dt>CONFIDENCE</dt><dd>98%</dd><dt>SOURCE</dt><dd>Page 12 · clause 4.1</dd></dl><p>Evidence remains attached.</p></article>
    </section>
    <footer class="bb-app-note">Illustrative application specimens · product behavior must follow <code>design-system/product-interface.md</code></footer>
  `);
}

export function renderChannels() {
  return brandSlide('Templates and channels', 'bb-channels', 14, 'ENABLEMENT', `
    <header class="bb-channel-head">
      <p class="bb-eyebrow">MAKE THE RIGHT THING EASY</p>
      <h1>Rules become useful<br>when the template is ready.</h1>
      <p>Start with the channels apparent actually ships. Add formats only when a real owner and workflow exist.</p>
    </header>
    <section class="bb-channel-matrix">
      <article><small>WEBSITE</small><strong>Transformation first</strong><p>Full wordmark · one decisive CTA · proof in the same frame</p></article>
      <article><small>LINKEDIN</small><strong>Substance over hype</strong><p>1200×627 · captions on video · category insight before promotion</p></article>
      <article><small>SALES DECK</small><strong>One claim + proof</strong><p>16:9 · visible sources · qualification stays on-slide</p></article>
      <article><small>DOCUMENT OUTPUT</small><strong>Provenance attached</strong><p>Paper/Carbon · full wordmark · source page + confidence</p></article>
      <article><small>EMAIL + SUPPORT</small><strong>Text first. Calm under pressure.</strong><p>No image-dependent meaning · direct verb · named next step</p></article>
      <article><small>PARTNERS</small><strong>Approval before lockup</strong><p>No icon-only co-brand · record deviation · use approved masters</p></article>
    </section>
    <footer class="bb-template-status">
      <div><small>AVAILABLE NOW</small><strong>Sales deck · product shell · structured output</strong></div>
      <div><small>NEXT TO SHIP</small><strong>LinkedIn post · one-pager · email signature</strong></div>
      <div><small>APPROVAL</small><strong>Founder until a named brand owner is assigned</strong></div>
    </footer>
  `);
}

export function renderGovernance() {
  return brandSlide('Assets and governance', 'bb-governance', 15, 'SOURCE OF TRUTH', `
    <section class="bb-governance-lead">
      <p class="bb-eyebrow">USE THE SOURCE</p>
      <h1>Everything needed<br>to design <span>apparent.</span></h1>
      <p>Approved assets, tokens and instructions live in this repository. Unresolved decisions stay unresolved.</p>
      ${wordmark()}
    </section>
    <section class="bb-file-tree" aria-label="Brand repository source tree">
      <div><span>APPROVED</span><strong>assets/brand/</strong><small>wordmark · icon · inverse variants</small></div>
      <div><span>CANONICAL</span><strong>design-system/tokens/</strong><small>JSON · CSS</small></div>
      <div><span>INSTRUCTIONS</span><strong>design-system/instructions/</strong><small>design · frontend implementation</small></div>
      <div><span>PRODUCT</span><strong>design-system/product-interface.md</strong><small>behavior · accessibility · credibility</small></div>
      <div><span>HISTORY</span><strong>docs/design-process/</strong><small>decisions · renders · QA · feedback</small></div>
    </section>
    <section class="bb-governance-rules">
      <div><small>DEVIATIONS</small><p>Approve before publishing. Record the reason, owner and expiry; exceptions never become defaults silently.</p></div>
      <div><small>AGENCIES</small><p>Share this live reference and approved assets at kickoff. External work follows the same review gate.</p></div>
      <div><small>ONBOARDING</small><p>Include a 15-minute brand walkthrough and direct repository access in the first week.</p></div>
      <div><small>FEEDBACK</small><p>Log missing scenarios in the repository and review the system each quarter.</p></div>
    </section>
    <footer class="bb-governance-meta">
      <div><small>STATUS</small><strong>Brand Core v0.2 / review</strong></div>
      <div><small>OWNER</small><strong>Founder approval required</strong></div>
      <div><small>PRECEDENCE</small><strong>Safety → assets → system → implementations</strong></div>
      <div><small>OPEN</small><strong>Print colors · co-branding · responsive type</strong></div>
    </footer>
  `);
}
