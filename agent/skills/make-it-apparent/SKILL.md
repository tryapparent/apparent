---
name: make-it-apparent
description: Use when told "make it apparent" or asked for video proof.
---

# Make It Apparent: make the situation understandable

When Simon says "make it apparent," produce a short video that makes the current topic understandable. A finished implementation is not a prerequisite. Choose the mode from the viewer's question and available evidence:

- **Change demo — What works now?** Record the exact working build, meaningful action and visible result. Verify claims that pixels alone cannot prove.
- **Problem demonstration — What goes wrong?** Record a safely reproducible current failure or limitation. Unresolved behavior is a valid subject. Distinguish an observed failure from a suspected cause; do not invent a fix or successful ending.
- **Technical explainer — Why does this happen?** Use source-checked diagrams, illustrations, code excerpts or inspected evidence with timed explanation. Label conceptual examples, hypotheses and proposed changes inside the video. Created explanatory visuals are valid primary material, not failed proof.

For a generic request about a user workflow, use the real-interaction or interactive-prototype route, even when implementation is unfinished. For a question about an invisible technical mechanism, a source-backed conceptual explainer can be the primary video. State the selected mode and limits briefly, then act. Explicit live-app, bug-reproduction, Apparent-capture and exact-build requests require that evidence or a precise blocker; a conceptual supplement cannot satisfy them. Never present a hypothetical sequence as an observed reproduction.

The capture guide applies to scenes claiming live behavior, not as prerequisites for conceptual explanation. Keep raw evidence unchanged and private, inspect the entire final video and never commit generated media. A recording is not a substitute for tests. A screen-share of the coding session is not a demonstration of a finished result.

## Show the workflow from the user's seat

For user-facing workflows, default to a narrated recording of the actual interaction, including when the request is only “make it apparent.” Show the starting screen, the action and its visible result in the environment the user would use. Use an isolated VM for desktop/OS workflows under the host's existing safety rules; check for active workers before staging or launching. Do not use a VM as a reason to bypass platform, consent or spending gates.

If the workflow is proposed rather than implemented, record a small interactive prototype with recognizable controls and visible state changes. Keep it within the approved design scope, outside shared implementation files, and label simulated behavior in the video. Do not build production integration merely to make a design walkthrough. If neither a real workflow nor an interactive prototype can be recorded, report the precise blocker; a deck describing the steps does not fulfill a workflow walkthrough.

For example, to explain recording-to-link handoff, show recording a harmless task, finishing, pasting into a private scratch destination, and opening the resulting recording as a recipient would. Show “Preparing recording” separately from playable readiness when applicable. Use isolated synthetic data and approved destinations; never post to a real agent session or publish a recording for a demo. In a prototype, label clipboard, upload, recipient playback and revocation simulations explicitly. Text such as “Finish → Paste with public link” is a storyboard instruction, not evidence that the viewer has seen that flow.

Narrate the action as it happens: what you do, what changes, and why it matters. Choose the approved narrator before rendering; prefer provisioned local narration and never send private script text to an online service without authorization. Keep subtitles synchronized, at most two short lines, clear of controls and results. Let the UI carry the visual story; omit explanatory paragraphs, fake text buttons, decorative watermarks and title-card sequences that compete with it. Add only a brief label, measured highlight or close-up when needed.

Use diagrams for a mechanism that cannot be seen through interaction, or when explanatory visuals are explicitly requested. An unfinished implementation or unavailable recorder alone does not turn a user workflow into a technical-explainer request. Keep any conceptual supplement clearly separate from the unfulfilled live-proof claim.

Before delivery, inspect the whole final movie at the intended player size. Check that each narrated action has a corresponding visible action and result, the flow is understandable without reading a deck, and proposals remain distinguishable from verified behavior. Reject and redo a take that merely reads steps over static cards. Codec/decode checks alone cannot pass this review. Skill wording changes need fresh agent trials before claiming improved recording behavior.

## Explain the cause, not the tool log

Before drafting, ask: **What does this viewer already know, and where must I pick them up?** Use the conversation and available context. Restore the immediate project context one local step before the unfamiliar mechanism; do not reteach familiar technical basics. If the evidence is thin, add one relevant bridge instead of asking the viewer to choose a level.

Open with one sentence stating the question, actual status and any required human action. Use **background → problem → mechanism/change → now → open → action**. These are story beats, not six mandatory slides. Give each beat's whole point first, then explain only the terms and causal links needed to follow it. Define unfamiliar things by a familiar class and relevant distinguishing feature. Use short active sentences and consistent names.

Show one concrete example moving through the mechanism: parts doing something to each other, not a component inventory or tool log. For example, a hypothetical timeline can save an earlier volume, lower it temporarily, accept a person's new choice, then show a naive restore overwriting that choice. Label this a **hypothetical example**, not a current app defect. Check any source before applying it to a product; show proposed protections separately from verified behavior.

For unfinished work, **now** explains the actual remaining gap, not a fictional success. State risks and untested claims before the ending. Finish with the real next action and owner, or "No human action is needed." Work still assigned to the agent stays with the agent.

Every mode needs timed, plain-spoken explanation, readable burned captions and editable timed text so the story works muted. Add synchronized generated voice by default unless the user requests silence or suitable narration already exists; disclose generated narration. Never play it through speakers during capture. Use only authorized speech services: do not send private text online or incur charges without permission. If narration is unavailable, report that production blocker; do not silently replace it with silence. An explicitly silent scenario can use captions alone, disclosed in the video and handoff.

## Point out the claim

1. Write one viewer question: “Can I now ___?”, “What goes wrong when ___?” or “Why does ___ cause ___?” Choose one checked scenario or labelled conceptual worked example. For a requested video, choose an explanatory visual sequence if live interaction adds nothing; do not silently downgrade to prose. For a verified bug fix, show the old failure if a safe capture exists, then the same task succeeding; never stage an old failure on the new build.
2. For live-proof scenes, identify the **exact build and environment**: commit or installed version, local/deployed URL where relevant, OS/device, and target window. Verify the app process or server actually serves that build. A local preview does not prove the released app, another platform, or the backend. Rehearse and confirm the result, not merely a successful click. For conceptual scenes, identify the source and separate observed facts, assumptions and proposed behavior instead.
3. Within a live-proof scene, capture starting state → meaningful action → visible result. Place it within the story above. Keep results readable and cut idle waiting, not evidence. Record the relevant assertion or test result separately if pixels alone cannot prove it.

Point at the claim, not every click. For a visual comparison, hold the same viewport and crop before and after. Use a sparse callout, outline or zoom only when the viewer might otherwise miss the changed region. Measure positions from the settled UI rather than guessing coordinates; recheck marks after scrolling or layout changes. Keep captions in empty space, and never cover the result they describe. Do not add arrows, measurements or captions merely to make the video look produced.

Make walkthrough videos at **30 fps by default**, including browser and generated review videos; use **60 fps only when the requester specifically asks for it**. A browser's live rendering rate is not the video's frame rate. Preserve real-time duration when encoding and verify the playable file's rate and duration before sharing it.

## Production guides

Use the [live capture and review guide](capture/README.md) for live proof.
Use the [narration and conceptual video guide](narration/README.md) to produce
and verify narration or render an explainer. The [source survey](references/README.md)
records the background for this workflow.
