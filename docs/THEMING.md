# visual-feedback: theming

The widget lives in one shadow root, so the site's CSS cannot break it, and its CSS cannot leak
out. There are four ways to adapt it, from lightest to heaviest:

## 1. It matches the site
Inside the shadow root, the widget sets `font: inherit`, so a site rule such as
`* { all: unset }` cannot reset it. With no theming at all, it takes the site's font, and it
reads the page when it loads, at each open (a draft opened again from its bar too), when
`theme` or `css` changes, and when the page switches its theme: a change to the attributes of `<html>` or
`<body>`, such as a `dark` class, that changes the page's background, text colour or
`color-scheme`, or a change of the system's light or dark. The trigger, the dialog and the draft
bar then take the new look at once, or, where the site fades its colours, when the fade ends. A
widget whose element was off the page reads the page again when the element is put back. The rest
of the page is not watched, so a look changed only by a new stylesheet shows at the next open.
What it reads:

- **accent:** the page's `<meta name="theme-color">` (one with a `media` attribute counts only
  where its media matches), else the most common coloured background
  of its buttons, else the colour of its links. Greys, muted colours, near black, near white and
  the browser's own unstyled buttons do not count.
- **corners:** the middle radius of the page's filled buttons, so the widget's buttons get the
  same, up to 15px. A site where at least half of the filled buttons are pills keeps the
  default.
- **background and text**, with `theme: "auto"`: the page's background and text colour, and light
  or dark from that background.

A guess is used only when it contrasts: the accent 3:1 against the widget's background, the text
4.5:1 against it. Otherwise the default stays: the system colours `Canvas`, `CanvasText` and
`AccentColor`, light and dark from the system, and `16px` corners. With the page's text, the
widget's hints take more of it than 60% where 60% would fall under 4.5:1. Each `--vf-*` variable
the site sets wins over the guess for that variable; a site that sets only one of `--vf-surface`
and `--vf-text` gets the other from the defaults.

## 2. CSS custom properties
Set these on `visual-feedback` (or on any ancestor). Custom properties cross the shadow boundary.

| variable | default | used for |
|---|---|---|
| `--vf-font` | `inherit` | font family of all text, such as `Inter, sans-serif` |
| `--vf-radius` | from the page's button corners, so the widget's buttons match them up to 15px (this is 1.6 times theirs, up to `24px`), else `16px` | panel and composer, and a share of it for buttons and the image |
| `--vf-surface` | with `theme: "auto"` the page's background, else `Canvas` | panel, tool rail and composer background |
| `--vf-text` | with `theme: "auto"` the page's text colour, else `CanvasText` | text |
| `--vf-muted` | text at 60%, more on a page whose text would make that too faint | hints, counters |
| `--vf-border` | text at 15% | hairlines |
| `--vf-accent` | the page's accent, else `AccentColor`, or `#0b57d0` where the browser has no `AccentColor` | Send button and its menu button, "Capture this view", active tool, chosen screenshot |
| `--vf-accent-text` | black or white, whichever contrasts more with the accent | text on the accent |
| `--vf-focus` | `--vf-accent` | focus ring |
| `--vf-mark` | `#e5243b` | marks on the screenshot |
| `--vf-backdrop` | `rgb(0 0 0 / 45%)` | overlay behind the image |
| `--vf-shadow` | `0 12px 32px -12px rgb(0 0 0 / 35%)` | trigger, panel and draft bar |
| `--vf-trigger-size` | `2.5em`, 40px on a 16px site | trigger height, and its width when it shows the icon alone |
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
`capture-view`, `reopen`, `discard`, `confirm`, `confirm-text`, `keep-draft`, `keep-editing`. Cancel's
question is `confirm`, also an `actions` part, with its own `discard` button. After a send error, the Send button's part is `retry` until it
sends again, the same part as the capture error's "Try again".

```css
visual-feedback::part(trigger) { opacity: .6; }
visual-feedback::part(trigger):hover { opacity: 1; }
```

## 4. The `css` option and `unstyled`
- `css` is a string. It is added as a constructable stylesheet inside the shadow root, after the
  defaults, so it can reach anything, including states that `::part()` cannot select.
- `unstyled: true` drops every default except the layout-critical rules (the trigger's position and
  size, the overlay's position, the panel's layout, canvas size, hidden states) and the focus ring,
  in `--vf-focus`, which `css` can restyle. Then the `css` option styles everything else.

```ts
createFeedback({ onSubmit, css: `.toolbar { gap: 2px } .send { text-transform: uppercase }` });
```
Class names used inside the shadow root are part of the public API from 1.0. Before 1.0 they may
change.

## Theme
`theme: "light" | "dark"` sets `color-scheme` inside the shadow root, which forces that scheme
with the system colours. `"auto"` follows the page's background (section 1), and the system
where the page shows none.
