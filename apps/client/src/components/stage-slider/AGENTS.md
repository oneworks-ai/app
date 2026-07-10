# Stage Slider Component

`stage-slider/` owns the reusable discrete slider used by compact controls such as the sender effort selector. Callers pass ordered stages and the selected value; this module owns the native range input, custom visual thumb, track fill, marks, drag preview, detent feel, and optional solid or multicolor stage particles.

## Interaction Rules

- Keep the real input as the accessibility and keyboard source of truth. The visual thumb may move continuously during pointer drag, but committed values must remain discrete stages.
- Pointer drag should preview continuously and only commit the nearest stage on release. Suppress native `onChange` while a pointer drag is active so event ordering cannot commit intermediate browser range values.
- Stage detents are visual resistance, not extra values. Near a mark, hold the preview on that exact stage; once the pointer leaves the pull zone, return to 1:1 tracking.
- Each hovered mark shows the label for that mark with the shared Ant Design `Tooltip`, placed below the slider so the sender's shortcut tooltip can remain above it. Keep the native input's accessible value tied to the committed selection so hover previews do not change screen-reader state.
- Endpoint marks and thumb centers need internal padding from the track edge. Do not place the first or last mark at the raw 0% / 100% border, or the square thumb and hover state will visually spill outside the rail.
- The track should be larger than the thumb in compact toolbar usage. Avoid `border-radius: 100%`; use small rounded rectangles / squares that match the app control language.

## Styling Rules

- Local consumers should tune dimensions through CSS custom properties on the root, for example width, height, thumb size, mark inset, and particle color. Do not copy the SCSS into business components.
- Avoid a visible seam where the left cap meets the filled rail. Keep the internal fill edges straight and let the filled segment overlap the cap by a small amount instead of depending on two adjacent rounded shapes to line up perfectly.
- Stage animation variants should appear on both the thumb and the track background. Callers select `solid` or `multicolor` from business state; do not hard-code business stage names in this component. Keep particle elements small, decorative, and covered by `prefers-reduced-motion`.
- Hover/focus mark animation must stay within the track height and should not grow larger than the surrounding rail.

## Validation

- Verify click, drag, release, arrow keys, Home, End, focus, and tooltip/label behavior in a real browser.
- For compact sender usage, inspect the actual bounding boxes: root width should be fully occupied by the track, endpoint marks should sit inside the track, and the custom thumb should align with the mark centers at every stage.
- When changing drag math, test an in-progress drag separately from release: during drag the visual thumb should follow or detent while the committed value stays unchanged until pointer up.
