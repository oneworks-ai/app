package ai.oneworks.android.bridge

import org.json.JSONObject

object WebViewBridgeScripts {
    fun installTargetProbe(targetId: String): String = """
        (() => {
          const targetId = ${JSONObject.quote(targetId)};
          if (window.__oneworksTargetBridgeInstalled === targetId) {
            return { installed: true, targetId };
          }
          window.__oneworksTargetBridgeInstalled = targetId;

          const describeElement = element => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            const value = "value" in element ? String(element.value) : undefined;
            const checked = "checked" in element ? Boolean(element.checked) : undefined;
            return {
              tagName: element.tagName,
              id: element.id || undefined,
              className: typeof element.className === "string" ? element.className : undefined,
              text: (element.innerText || element.textContent || "").trim().slice(0, 500),
              value,
              checked,
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              }
            };
          };

          const send = (type, detail) => {
            if (!window.OneWorksTarget || typeof window.OneWorksTarget.postMessage !== "function") {
              return;
            }
            window.OneWorksTarget.postMessage(JSON.stringify({
              type,
              targetId,
              detail,
              title: document.title,
              url: location.href,
              at: Date.now()
            }));
          };

          const handleDomEvent = event => {
            const element = event.target instanceof Element ? event.target : null;
            send("dom-event", {
              eventType: event.type,
              element: describeElement(element)
            });
          };

          ["click", "input", "change", "submit", "focus"].forEach(type => {
            document.addEventListener(type, handleDomEvent, true);
          });

          send("bridge-installed", { readyState: document.readyState });
          return { installed: true, targetId };
        })();
    """.trimIndent()

    fun query(selector: String): String = """
        (() => {
          const selector = ${JSONObject.quote(selector)};
          const element = document.querySelector(selector);
          const describeElement = ${describeElementFunction()};
          return {
            selector,
            exists: element != null,
            element: describeElement(element)
          };
        })();
    """.trimIndent()

    fun click(selector: String): String = """
        (() => {
          const selector = ${JSONObject.quote(selector)};
          const element = document.querySelector(selector);
          const describeElement = ${describeElementFunction()};
          if (!element) {
            return { selector, clicked: false, exists: false };
          }
          element.scrollIntoView({ block: "center", inline: "center" });
          element.click();
          return {
            selector,
            clicked: true,
            exists: true,
            element: describeElement(element)
          };
        })();
    """.trimIndent()

    fun setValue(selector: String, value: String): String = """
        (() => {
          const selector = ${JSONObject.quote(selector)};
          const value = ${JSONObject.quote(value)};
          const element = document.querySelector(selector);
          const describeElement = ${describeElementFunction()};
          if (!element) {
            return { selector, updated: false, exists: false };
          }
          element.focus();
          element.value = value;
          let inputEvent;
          try {
            inputEvent = new InputEvent("input", { bubbles: true, inputType: "insertText", data: value });
          } catch (_error) {
            inputEvent = new Event("input", { bubbles: true });
          }
          element.dispatchEvent(inputEvent);
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return {
            selector,
            updated: true,
            exists: true,
            element: describeElement(element)
          };
        })();
    """.trimIndent()

    private fun describeElementFunction(): String = """
        (element => {
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          const value = "value" in element ? String(element.value) : undefined;
          const checked = "checked" in element ? Boolean(element.checked) : undefined;
          return {
            tagName: element.tagName,
            id: element.id || undefined,
            className: typeof element.className === "string" ? element.className : undefined,
            text: (element.innerText || element.textContent || "").trim().slice(0, 500),
            value,
            checked,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            }
          };
        })
    """.trimIndent()
}
