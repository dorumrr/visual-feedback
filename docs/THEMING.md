# visual-feedback: theming

The widget lives in one shadow root, so the site's CSS cannot break it, and its CSS cannot leak
out. There are four ways to adapt it, from lightest to heaviest:

## 1. It inherits
Inside the shadow root, the widget sets `font: inherit` and `color-scheme: light dark`, so a site
rule such as `* { all: unset }` cannot reset them. The defaults use the system colours `Canvas`,
`CanvasText` and `AccentColor`. With no theming at all, it takes the site's font and follows light
and dark mode.

## 2. CSS custom properties
Set these on `visual-feedback` (or on any ancestor). Custom properties cross the shadow boundary.

| variable | default | used for |
|---|---|---|
| `--vf-font` | `inherit` | font family of all text, such as `Inter, sans-serif` |
| `--vf-radius` | `16px` | panel and composer, and a share of it for buttons and the image |
| `--vf-surface` | `Canvas` | panel, tool rail and composer background |
| `--vf-text` | `CanvasText` | text |
| `--vf-muted` | text at 60% | hints, counters |
| `--vf-border` | text at 15% | hairlines |
| `--vf-accent` | `AccentColor`, or `#0b57d0` where the browser has no `AccentColor` | Send button, active tool |
| `--vf-accent-text` | black or white, whichever contrasts more with the accent | text on the accent |
| `--vf-focus` | `--vf-accent` | focus ring |
| `--vf-mark` | `#e5243b` | marks on the screenshot |
| `--vf-backdrop` | `rgb(0 0 0 / 45%)` | overlay behind the image |
| `--vf-shadow` | `0 12px 32px -12px rgb(0 0 0 / 35%)` | trigger, panel and draft bar |
| `--vf-trigger-size` | `2.5em`, 40px on a 16px site | trigger height |
| `--vf-offset` | `16px` | trigger and draft bar distance from the edges |
| `--vf-z` | `2147483000` | stacking |

```css
visual-feedback {
  --vf-accent: #2563eb;
  --vf-accent-text: #fff;
  --vf-radius: 8px;
}
```

## 3. `::part()`
Every visible element has a part name: `trigger`, `trigger-icon`, `trigger-text`, `backdrop`,
`dialog`, `header`, `title`, `minimise`, `body`, `stage`, `image`, `toolbar`, `tool`, `tool-active`,
`divider`, `undo`, `clear`, `remove`, `icon`, `text-input`, `selection`, `strip`, `thumb`,
`thumb-pick`, `thumb-image`, `thumb-number`, `thumb-remove`, `add`, `label`, `composer`, `note`,
`composer-bar`, `category`, `footer`, `split`, `send-more`, `menu`, `save-pdf`, `actions`, `cancel`,
`send`, `hint`, `status`, `error`, `retry`, `send-without`, `draft`, `draft-label`, `draft-thumbs`,
`capture-view`, `reopen`, `discard`.

```css
visual-feedback::part(trigger) { opacity: .6; }
visual-feedback::part(trigger):hover { opacity: 1; }
```

## 4. The `css` option and `unstyled`
- `css` is a string. It is added as a constructable stylesheet inside the shadow root, after the
  defaults, so it can reach anything, including states that `::part()` cannot select.
- `unstyled: true` drops every default except the layout-critical rules (the trigger's position and
  size, the overlay's position, the panel's layout, canvas size, hidden states). Then the `css` option styles everything.

```ts
createFeedback({ onSubmit, css: `.toolbar { gap: 2px } .send { text-transform: uppercase }` });
```
Class names used inside the shadow root are part of the public API from 1.0. Before 1.0 they may
change.

## Theme
`theme: "light" | "dark"` sets `color-scheme` inside the shadow root, which forces that scheme.
`"auto"` follows the system.
