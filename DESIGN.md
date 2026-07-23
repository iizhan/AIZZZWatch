# AIZZZWatch Design System

## Overview

AIZZZWatch is a quiet, dense macOS utility for scanning the health and cost posture of multiple Sub2API relay stations. The interface should feel like an operations instrument: fast to parse, calm under failure, and useful in a narrow floating window. It is not a marketing page and should avoid decorative illustration.

## Colors

- Canvas: `#F4F6F8`
- Surface: `#FFFFFF`
- Surface muted: `#EEF1F4`
- Ink: `#17212B`
- Ink muted: `#66727E`
- Border: `#D7DDE3`
- Accent blue: `#1769E0`
- Success: `#1E8A5A`
- Warning: `#B56B00`
- Danger: `#C43D4B`
- Dark mode canvas: `#171A1F`
- Dark mode surface: `#20252C`

Accent colors are semantic and sparse. Do not use gradients, decorative blobs, or a one-hue palette.

## Typography

- System font stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif`
- Display: 22px / 28px, semibold
- Section heading: 14px / 20px, semibold
- Body: 13px / 18px, regular
- Numeric emphasis: 20px / 24px, semibold with tabular numerals
- Caption: 11px / 16px, medium

## Layout

- Base spacing scale: 4, 8, 12, 16, 20, 24.
- Main window content uses a 16px inset and a two-column desktop grid.
- Narrow mode collapses to one column while keeping balance and refresh controls visible.
- Use stable row heights for status and group tables; allow names to truncate with a tooltip.
- Top chrome is compact and action-oriented: refresh, window mode, and settings use icon buttons with tooltips.

## Elevation And Depth

- Use one subtle shadow for the main floating surface: `0 8px 24px rgba(23, 33, 43, 0.12)`.
- Prefer 1px borders and background contrast over stacked cards.
- Cards are individual repeated station/group items only; do not nest cards inside cards.

## Shapes

- Default radius: 8px.
- Compact controls: 6px.
- Menu bar and bubble controls may be circular when the native shape is expected.
- Avoid pill-shaped text controls except for status badges.

## Components

- Icon button: 28px square, semantic label, visible focus ring, tooltip for unfamiliar icons.
- Station row: name, health dot, balance, last update, and a compact overflow action.
- Group row: platform, group name, multiplier, effective price hint, and account count when admin data is available.
- Status badge: color plus text; never rely on color alone.
- Confirmation dialog: title, exact remote mutation summary, affected station/account, confirm and cancel actions.

## Do's And Don'ts

- Do keep the first viewport focused on live balances and group health.
- Do show loading, stale, offline, forbidden, and retry states at the affected station.
- Do keep credentials out of renderer state and all logs.
- Don't add marketing copy, hero sections, large illustrations, gradients, or decorative orbs.
- Don't hide a remote mutation behind a generic refresh or selection click.

## Responsive Behavior

- Supported surfaces: full window, compact floating window, bubble, and menu bar popover.
- At widths below 620px, collapse the station summary and group detail into a vertical flow.
- At widths below 420px, prioritize station name, health, balance, refresh, and the selected group; move secondary pricing details behind disclosure.
- Respect reduced motion and preserve keyboard focus when dialogs or popovers close.
