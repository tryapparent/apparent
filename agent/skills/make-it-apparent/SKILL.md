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

Open the spoken script with one sentence stating the viewer's question, the current status and any action the viewer needs to take. Then use these six beats in order. Give each beat's main point in its first sentence. Add only the local context, terms and causal links the viewer needs. Define unfamiliar things by a familiar class and the feature that matters here. Use short active sentences and consistent names.

1. **Background** — Show the relevant earlier situation. Explain what this part does and how it worked before the problem or change.
2. **Problem** — Say what went wrong, who experienced it and what it prevented or cost them. Use reliable footage of the old behavior when available. Say when the affected group or impact is unknown.
3. **Change** — Explain the cause and what was done about it. Show how the change addresses the cause in the same example. For unresolved work, say what has been tried or proposed and label any unconfirmed cause.
4. **Now** — Show what happens today. State where the behavior is available and what the evidence verifies. If the problem persists, show the current failure or remaining gap.
5. **Open** — Name the main risk, unanswered question or important untested case that affects the conclusion.
6. **Action** — End the video by telling the viewer exactly what they need to do, or say “No action is needed from you.” Separately state the next step and who owns it. If nothing remains, say the work is complete. Keep work assigned to the agent with the agent.

Put the verified delivery status in the spoken ending and captions. For implementation work, say whether it is on `main`, whether CI passed on the landed commit, and whether it was released or is available, when those milestones apply. Use current evidence for each claim. Say which milestone is pending or unknown when it affects the handoff. A local test establishes local behavior, a merge establishes integration, and release evidence establishes availability.

Let the beats flow through the footage or explanatory visuals. A single sequence can carry several beats.

Show one concrete example moving through the mechanism: parts doing something to each other, not a component inventory or tool log. For example, a hypothetical timeline can save an earlier volume, lower it temporarily, accept a person's new choice, then show a naive restore overwriting that choice. Label this a **hypothetical example**, not a current app defect. Check any source before applying it to a product; show proposed protections separately from verified behavior.

During the final review, ask whether a viewer can explain who was affected, what changed for them or still happens, and how we know. If impact is unknown, the viewer should be able to tell what evidence is missing. Watch the ending on its own and confirm that the viewer can tell what is available, whether they need to act, and what happens next or whether the work is complete.

Every mode needs timed, plain-spoken explanation, readable burned captions and editable timed text so the story works muted. Use local Kokoro `bm_fable` for synchronized generated narration by default. Preserve suitable live speech or honor a request for silence. Verify and disclose the narrator identity. Never play narration through speakers during capture. If Kokoro cannot synthesize, report the exact blocker. A different voice or online service requires explicit approval. An explicitly silent scenario can use captions alone, disclosed in the video and handoff.

## Point out the claim

1. Write one viewer question: “Can I now ___?”, “What goes wrong when ___?” or “Why does ___ cause ___?” Choose one checked scenario or labelled conceptual worked example. For a requested video, choose an explanatory visual sequence if live interaction adds nothing; do not silently downgrade to prose. For a verified bug fix, show the old failure if a safe capture exists, then the same task succeeding; never stage an old failure on the new build.
2. For live-proof scenes, identify the **exact build and environment**: commit or installed version, local/deployed URL where relevant, OS/device, and target window. Verify the app process or server actually serves that build. A local preview does not prove the released app, another platform, or the backend. Rehearse and confirm the result, not merely a successful click. For conceptual scenes, identify the source and separate observed facts, assumptions and proposed behavior instead.
3. Within a live-proof scene, capture starting state → meaningful action → visible result. Place it within the story above. Keep results readable and cut idle waiting, not evidence. Record the relevant assertion or test result separately if pixels alone cannot prove it.

Open on one recognizable situation. Use the full screen and one mark to show what the viewer should notice. Before the first gesture or menu step, say who is trying to do what, what went wrong, and why it matters. Talk as if the viewer were sitting next to you. Point to what happened, show what came out, then show what should be there or what actually changed. Keep dense output out of the opening.

When a red circle, underline, or box locates something on screen, keep the whole source screen visible. Leave the mark on the same target across a cut when that target remains visible, so the viewer can follow it without searching again. Mark the evidence where it appears in the original UI. Check the cut at the intended player size for readability, and keep captions clear of the marked detail.

When narration walks through a chart, keep the whole chart visible and move one highlight to the row or mark being discussed. Include its label and value in the highlight. Time the change to the spoken phrase so the viewer can find it as they hear it. Verify the transitions against the final audio and leave enough contrast for the surrounding data.

During review, show one timestamp or short range and ask one focused question about what the viewer noticed or understood. Use that answer to choose the next review moment. If work stops until the viewer authorizes a proposed step, ask for that decision explicitly in the ending.

Point at the claim, not every click. For a visual comparison, hold the same full-screen framing before and after. Use a sparse callout when the viewer might otherwise miss the changed region. Measure positions from the settled UI rather than guessing coordinates; recheck marks after scrolling or layout changes. Keep captions in empty space, and never cover the result they describe. Do not add arrows, measurements or captions merely to make the video look produced.

Make walkthrough videos at **30 fps by default**, including browser and generated review videos; use **60 fps only when the requester specifically asks for it**. A browser's live rendering rate is not the video's frame rate. Preserve real-time duration when encoding and verify the playable file's rate and duration before sharing it.

## Production guides

Use the [live capture and review guide](capture/README.md) for live proof.
Use the [narration and conceptual video guide](narration/README.md) to produce
and verify narration or render an explainer. The [source survey](references/README.md)
records the background for this workflow.
