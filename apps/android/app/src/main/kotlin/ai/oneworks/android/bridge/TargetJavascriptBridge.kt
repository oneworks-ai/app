package ai.oneworks.android.bridge

import android.webkit.JavascriptInterface
import org.json.JSONObject

class TargetJavascriptBridge(
    private val targetId: String,
    private val dispatcher: NativeEventDispatcher
) {
    @JavascriptInterface
    fun postMessage(rawMessage: String) {
        runCatching {
            JSONObject(rawMessage).apply {
                put("targetId", targetId)
            }
        }.onSuccess { message ->
            dispatcher.emit("target.domEvent", message)
        }.onFailure { error ->
            dispatcher.emit(
                "target.domEvent",
                JSONObject().apply {
                    put("targetId", targetId)
                    put("type", "bridge-parse-error")
                    put("raw", rawMessage)
                    put("message", error.message)
                }
            )
        }
    }
}
