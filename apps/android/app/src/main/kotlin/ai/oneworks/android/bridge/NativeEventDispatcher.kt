package ai.oneworks.android.bridge

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import org.json.JSONObject

class NativeEventDispatcher(private val hostWebView: WebView) {
    private val mainHandler = Handler(Looper.getMainLooper())

    fun resolve(requestId: String, result: Any?) {
        runCatching {
            JSONObject().apply {
                put("id", requestId)
                put("ok", true)
                put("result", BridgeJson.jsonValue(result))
            }
        }.onSuccess { payload ->
            emit("bridge.response", payload)
        }.onFailure { error ->
            reject(requestId, "bridge_response_error", error.message)
        }
    }

    fun reject(requestId: String, code: String, message: String?) {
        runCatching {
            val error = JSONObject().apply {
                put("code", code)
                put("message", message ?: code)
            }
            JSONObject().apply {
                put("id", requestId)
                put("ok", false)
                put("error", error)
            }
        }.onSuccess { payload ->
            emit("bridge.response", payload)
        }
    }

    fun emit(type: String, payload: JSONObject = JSONObject()) {
        runCatching {
            JSONObject().apply {
                put("type", type)
                put("payload", payload)
            }
        }.onSuccess(::dispatchEnvelope)
    }

    private fun dispatchEnvelope(envelope: JSONObject) {
        mainHandler.post {
            val script = "window.__oneworksNativeBridgeDispatch && " +
                "window.__oneworksNativeBridgeDispatch($envelope);"
            hostWebView.evaluateJavascript(script, null)
        }
    }
}
