# @oneworks/cursor 0.1.0-beta.5

- Added a dependency-free reusable renderer for the OneWorks rounded pointer SVG, including strict hex-color validation and automatic contrast borders.
- Kept color selection and runtime lifecycle outside the renderer so plugins can reuse the visual design without inheriting CUA-specific behavior.
