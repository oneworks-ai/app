export const CHAT_MARKDOWN_LINK_SYSTEM_PROMPT = `<system-prompt>
When you include an actionable link in a OneWorks chat response, use standard Markdown title metadata to declare the intended OneWorks behavior:
- Open an HTTP(S) page inside the OneWorks interaction panel (iframe in Web, webview in Desktop): [label](https://example.com "oneworks:open=internal")
- Open an HTTP(S) page in the user's default external browser: [label](https://example.com "oneworks:open=external")
- Open a text or source file from the current workspace in the OneWorks file viewer: [label](path/to/file.ts "oneworks:open=workspace-file")
Use workspace-relative paths for workspace files. Never use this metadata to request arbitrary filesystem access. Omit the metadata for ordinary links that do not require a specific opening behavior.
</system-prompt>`

export const buildChatMarkdownSystemPrompt = () => CHAT_MARKDOWN_LINK_SYSTEM_PROMPT
