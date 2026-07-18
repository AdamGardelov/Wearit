# Outfit Delete Control Design

**Date:** 2026-07-18
**Status:** Approved

## Problem

The saved-outfit delete trigger is intended to be a small corner control, but the more-specific `.outfit-card button` rule overrides its width, minimum height, background, border, and color. It therefore renders as a full-width black bar over the thumbnail on touch devices and when revealed by hover on desktop.

## Design

- Keep the delete trigger in the thumbnail's top-right corner.
- On touch/no-hover devices, keep it visible so deletion remains discoverable.
- On hover-capable devices, reveal it when the outfit card is hovered or the trigger receives keyboard focus.
- Use a subtle neutral circular visual, with a muted icon and restrained accent color on hover.
- Preserve a minimum 44 by 44 pixel interaction target while rendering the visible circular surface smaller inside that target.
- Keep the existing inline confirmation, cancellation, deletion, error, and accessibility behavior unchanged.

## Implementation boundary

Fix the selector conflict at its source by exempting or overriding the corner trigger with sufficient specificity. Do not change repository deletion behavior, card actions, outfit data, thumbnails, filtering, or confirmation flow.

## Verification

- Add a focused style regression check proving the corner trigger wins over the generic outfit-card button rule.
- Keep the existing delete interaction tests green.
- Run the focused OutfitsView tests and the production build.
- Manually inspect mobile/no-hover and desktop hover/focus behavior.
