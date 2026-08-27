# Avatar Editor and Developer Integration

OneWorks Avatar is a browser-based geometric 3D avatar editor with developer components built on the same renderer as the hosted product. Save an editable source, export SVG/PNG/GIF, or render and edit a versioned Avatar definition directly in React, Vue, and Vanilla JavaScript applications.

Open the hosted editor at [oneworks.cloud/avatar](https://oneworks.cloud/avatar/).

## Create and export

1. Choose a built-in avatar on the home page, or enter the editor to build your own geometric character.
2. Adjust pose, position, scale, face, materials, lighting, shadows, outline, and animation.
3. Enter camera mode and choose the output size, frame, and background.
4. Copy SVG or download SVG, PNG, or animated GIF.

The editor supports Simplified Chinese and English. Its theme can follow the system or be switched manually between light and dark.

| Format | Use                 | Behavior                                                                                      |
| ------ | ------------------- | --------------------------------------------------------------------------------------------- |
| SVG    | Static vector asset | Preserves the current 3D scene projection, camera background, and frame clipping.             |
| PNG    | Static raster asset | Supports transparent backgrounds for application avatars, social platforms, and design files. |
| GIF    | Animated asset      | Exports the selected animation and is unavailable until an animation is selected.             |

Export sizes are 128, 256, and 512 pixels. The camera background can be a color or transparent, and the camera frame can be square, rounded, or circular. Pixels outside rounded and circular frames remain transparent.

## Developer integration

The 3D Runtime and framework adapters share version `1.0.0-rc.6`. `@oneworks/avatar` is now the framework-neutral 3D core package; the old 2D pixel renderer is no longer retained.

```bash
pnpm add @oneworks/avatar@rc
# Add one or more adapters for your application.
pnpm add @oneworks/avatar-react@rc @oneworks/avatar-vue@rc @oneworks/avatar-web@rc
```

| Package                  | Purpose                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| `@oneworks/avatar`       | Versioned definitions, validation, serialization, and animation runtime. |
| `@oneworks/avatar-react` | React `Avatar` renderer and full `AvatarEditor`.                         |
| `@oneworks/avatar-vue`   | Vue `OneWorksAvatar` and `OneWorksAvatarEditor`.                         |
| `@oneworks/avatar-web`   | Vanilla JavaScript mounts and explicitly registered Web Components.      |

Continue with the guide for your integration target:

- [Definitions, custom animations, React, and Vue](./avatar-runtime.md)
- [Vanilla JavaScript, Web Components, controllers, and events](./avatar-web.md)

## Save the editable source and application asset

Even when an application uses the Runtime, keep editable and deployable sources separately:

```ts
interface AvatarAssetRecord {
  definition: AvatarDefinition
  editorUrl?: string
  assetUrl?: string
  format?: 'svg' | 'png' | 'gif'
}
```

- `definition` drives Runtime rendering and programmatic animation.
- `editorUrl` is the complete share URL produced by the editor; store it as an opaque value.
- `assetUrl` points to an exported file on a static asset host or media store.
- The editor URL is not an image URL and should not be used as `<img src>`.

## Agent Skill

The Avatar repository includes the `oneworks-avatar` Agent Skill for creating, debugging, exporting, and integrating avatars:

```bash
npx skills@latest add oneworks-ai/avatar
```

The Skill uses the real editor and its 3D scene model instead of redrawing results through an image generator.

## Source, local development, and deployment

The 3D editor, `@oneworks/avatar` Runtime, framework adapters, and export pipeline all live in [`oneworks-ai/avatar`](https://github.com/oneworks-ai/avatar).

The Avatar repository is mounted into the app repository as the `assets/avatar` submodule, and its four public packages are also members of the app root workspace. The Avatar repository can still be checked out independently and use an `app-source` checkout or symlink for shared package source.

```bash
pnpm install --no-frozen-lockfile
ln -s /path/to/oneworks-app app-source
ONEWORKS_APP_SOURCE_DIR=app-source pnpm dev
ONEWORKS_APP_SOURCE_DIR=app-source pnpm test
ONEWORKS_APP_SOURCE_DIR=app-source pnpm typecheck:sdk
ONEWORKS_APP_SOURCE_DIR=app-source pnpm smoke:sdk
```

The Avatar page is published by the Avatar repository's `deploy-avatar.yml` workflow. After protected Avatar `main` passes `Avatar SDK CI`, the same verified source is deployed automatically. The app repository supplies shared build dependencies only; its submodule pointer does not select the production Avatar version. The main docs workflow publishes this page from `.oo/docs`.
