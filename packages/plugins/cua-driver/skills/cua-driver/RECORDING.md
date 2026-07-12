# External Recording

Recording is an orchestration responsibility, not a Cua Driver child-session action.

- The child session only performs and verifies the requested native-app operation.
- The parent or test harness records the system display and captures key screenshots.
- System-display evidence must show the visible Agent pointer while the user's foreground app remains unchanged.
- Per-action trajectory screenshots and `cursor.jsonl` remain diagnostic artifacts; a slideshow rendered from them does not prove live pointer motion.

Do not call `set_recording`, `get_recording_state`, `replay_trajectory`, or `finalize_recording` from this skill flow.
