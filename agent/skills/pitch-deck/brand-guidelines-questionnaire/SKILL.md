---
name: brand-guidelines-questionnaire
description: Interview a user to turn their answers and visual references into a basic brand guide. Use for a first brand brief, especially before designing a pitch deck, landing page, or other branded materials.
---

# Create a basic brand guide

Use the questions below as a worksheet or ask them in short batches during a live conversation. Reuse answers already given and let the user skip decisions they want help making. Invite links, screenshots, or uploads at the start so the user can point to examples as they answer.

## Questions

1. **Purpose.** What is the brand called, what does it offer, and where will people encounter it first? For a pitch deck, who will see it and what do you want them to do afterward?
2. **Audience and promise.** Who is it for, what problem do they have, and what should they remember about you in one sentence?
3. **Character.** What three words should describe the brand? What three words should people never use to describe it?
4. **Visual references.** Can you share a Pinterest board, landing page, deck, or screenshots you like? For each, what would you borrow or avoid? Point to specifics such as the type, color, spacing, images, or reading order. If a reference is private or inaccessible, ask for screenshots or a description.
5. **Existing assets.** What logos, fonts, colors, photos, or examples do you already use? Which are fixed, and which can change?
6. **Color and type.** What should the background, text, and accent do? What sort of typography feels right? Are there established fonts, weights, or sizes for headlines, body text, and labels?
7. **Layout and imagery.** How dense should things feel? Where should the eye land first? What kinds of photography, illustrations, diagrams, or charts belong in the brand?
8. **Voice.** How should the brand sound? Give one line that sounds like you and, if helpful, one that feels wrong.

## Turn the answers into the guide

Return a one-page Markdown guide. Include the audience and promise, brand character and voice, reference links with what to take from each, and practical rules for logo and assets, color, typography, layout, and imagery. Give color values by role and typography by role, family, weight, and size where known. If the guide is for slides, give type sizes against a stated canvas size so they can be checked on the rendered deck. Use the project's existing canvas and type scale when supplied.

If the user leaves a choice open, offer a concrete starting point marked **Proposed**, or mark it **Open** if it needs their input. Preserve supplied constraints and distinguish approved assets from inspiration. Inspect accessible references before describing them, and attribute user descriptions when you cannot see a reference yourself.

For a deck, pass this guide into the existing `document-slide-design-process` skill as the brand reference. Use its image-generated Crazy 8s workflow, then use the guide to check the refined slide's actual fonts, sizes, color roles, and visual hierarchy in the deck renderer.
