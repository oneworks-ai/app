# @oneworks/cursor

Reusable OneWorks pointer cursor renderer for plugins and host runtimes.

The package owns only the rounded pointer SVG design, color validation, and contrasting border rendering. Callers own color selection, session identity, storage, lifecycle, motion, and permissions.

```js
const { createOneWorksCursorSvg } = require('@oneworks/cursor')
const svg = createOneWorksCursorSvg({ color: '#625BF6' })
```
