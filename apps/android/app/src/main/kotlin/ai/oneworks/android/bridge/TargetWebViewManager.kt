package ai.oneworks.android.bridge

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Message
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONObject

class TargetWebViewManager(
    private val activity: Activity,
    private val container: FrameLayout,
    private val dispatcher: NativeEventDispatcher,
    private val assetLoader: BundledAssetLoader
) {
    private val targets = linkedMapOf<String, WebView>()
    private var activeTargetId: String? = null
    private var nextTargetIndex = 1

    fun createTarget(params: JSONObject): JSONObject {
        val requestedTargetId = params.optString("targetId", "").trim()
        val targetId = requestedTargetId.ifEmpty { "target-${nextTargetIndex++}" }
        require(!targets.containsKey(targetId)) { "Target already exists: $targetId" }

        val webView = createTargetWebView(targetId)
        targets[targetId] = webView
        container.visibility = View.VISIBLE
        container.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setActiveTarget(targetId)
        loadTarget(webView, params)
        return describeTarget(targetId, webView)
    }

    fun showTarget(params: JSONObject): JSONObject {
        val targetId = resolveTargetId(params)
        val webView = requireTarget(targetId)
        setActiveTarget(targetId)
        return describeTarget(targetId, webView).also { dispatcher.emit("target.shown", it) }
    }

    fun destroyTarget(params: JSONObject): JSONObject {
        val targetId = resolveTargetId(params)
        val webView = requireTarget(targetId)
        targets.remove(targetId)
        container.removeView(webView)
        webView.destroy()

        if (targetId == activeTargetId) {
            activeTargetId = targets.keys.firstOrNull()
            activeTargetId?.let(::setActiveTarget)
            if (activeTargetId == null) {
                container.visibility = View.GONE
            }
        }

        return JSONObject().apply {
            put("targetId", targetId)
            put("remainingTargets", targets.size)
        }.also { dispatcher.emit("target.destroyed", it) }
    }

    fun snapshotTarget(params: JSONObject): JSONObject {
        val targetId = resolveTargetId(params)
        return describeTarget(targetId, requireTarget(targetId))
    }

    fun createWindow(resultMsg: Message): Boolean {
        val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
        val targetId = "target-${nextTargetIndex++}"
        val webView = createTargetWebView(targetId)
        targets[targetId] = webView
        container.visibility = View.VISIBLE
        container.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setActiveTarget(targetId)
        transport.webView = webView
        resultMsg.sendToTarget()
        dispatcher.emit("target.created", describeTarget(targetId, webView))
        return true
    }

    fun evaluate(params: JSONObject, callback: BridgeCallback) {
        runCatching {
            evaluateScript(
                targetId = resolveTargetId(params),
                script = BridgeJson.requireString(params, "script"),
                callback = callback
            )
        }.onFailure { callback.reject("target_evaluate_error", it.message) }
    }

    fun inject(params: JSONObject, callback: BridgeCallback) {
        runCatching {
            evaluateScript(
                targetId = resolveTargetId(params),
                script = BridgeJson.requireString(params, "script"),
                callback = callback
            )
        }.onFailure { callback.reject("target_inject_error", it.message) }
    }

    fun query(params: JSONObject, callback: BridgeCallback) {
        runCatching {
            evaluateScript(
                targetId = resolveTargetId(params),
                script = WebViewBridgeScripts.query(BridgeJson.requireString(params, "selector")),
                callback = callback
            )
        }.onFailure { callback.reject("target_query_error", it.message) }
    }

    fun click(params: JSONObject, callback: BridgeCallback) {
        runCatching {
            evaluateScript(
                targetId = resolveTargetId(params),
                script = WebViewBridgeScripts.click(BridgeJson.requireString(params, "selector")),
                callback = callback
            )
        }.onFailure { callback.reject("target_click_error", it.message) }
    }

    fun setValue(params: JSONObject, callback: BridgeCallback) {
        runCatching {
            evaluateScript(
                targetId = resolveTargetId(params),
                script = WebViewBridgeScripts.setValue(
                    selector = BridgeJson.requireString(params, "selector"),
                    value = params.optString("value", "")
                ),
                callback = callback
            )
        }.onFailure { callback.reject("target_set_value_error", it.message) }
    }

    fun goBackIfPossible(): Boolean {
        val webView = activeTargetId?.let(targets::get) ?: return false
        if (!webView.canGoBack()) return false
        webView.goBack()
        return true
    }

    fun destroyAll() {
        targets.values.forEach { webView ->
            container.removeView(webView)
            webView.destroy()
        }
        targets.clear()
        activeTargetId = null
        container.visibility = View.GONE
    }

    private fun evaluateScript(targetId: String, script: String, callback: BridgeCallback) {
        requireTarget(targetId).evaluateJavascript(script) { rawResult ->
            callback.resolve(BridgeJson.parseEvaluateResult(rawResult))
        }
    }

    private fun loadTarget(webView: WebView, params: JSONObject) {
        val html = params.optString("html", "").trim()
        if (html.isNotEmpty()) {
            webView.loadDataWithBaseURL(
                BridgeJson.optionalString(params, "baseUrl", "https://oneworks.local/"),
                html,
                "text/html",
                "UTF-8",
                null
            )
            return
        }

        val url = BridgeJson.optionalString(
            params,
            "url",
            "file:///android_asset/target/demo.html"
        )
        webView.loadUrl(url.normalizeTargetUrl())
    }

    private fun resolveTargetId(params: JSONObject): String {
        val requestedId = params.optString("targetId", "").trim()
        if (requestedId.isNotEmpty()) return requestedId
        return activeTargetId ?: error("No active target WebView.")
    }

    private fun requireTarget(targetId: String): WebView =
        targets[targetId] ?: error("Unknown target WebView: $targetId")

    private fun setActiveTarget(targetId: String) {
        activeTargetId = targetId
        targets.forEach { (id, webView) ->
            webView.visibility = if (id == targetId) View.VISIBLE else View.GONE
        }
    }

    private fun describeTarget(targetId: String, webView: WebView) = JSONObject().apply {
        put("targetId", targetId)
        put("active", targetId == activeTargetId)
        put("title", webView.title)
        put("url", webView.url)
        put("canGoBack", webView.canGoBack())
        put("canGoForward", webView.canGoForward())
        put("targetCount", targets.size)
    }

    private fun emitTargetLoad(targetId: String, webView: WebView, url: String?) {
        runCatching {
            describeTarget(targetId, webView).apply {
                put("url", url)
            }
        }.onSuccess { dispatcher.emit("target.load", it) }
    }

    private fun emitTargetTitle(targetId: String, title: String?) {
        dispatcher.emit(
            "target.title",
            JSONObject().apply {
                put("targetId", targetId)
                put("title", title.orEmpty())
            }
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createTargetWebView(targetId: String) = WebView(activity).apply {
        setBackgroundColor(Color.WHITE)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.loadWithOverviewMode = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.setSupportMultipleWindows(true)
        settings.useWideViewPort = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.safeBrowsingEnabled = true
        }
        addJavascriptInterface(TargetJavascriptBridge(targetId, dispatcher), "OneWorksTarget")
        webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                view.evaluateJavascript(WebViewBridgeScripts.installTargetProbe(targetId), null)
                emitTargetLoad(targetId, view, url)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = false

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request)
        }
        webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(
                view: WebView,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: Message
            ): Boolean = createWindow(resultMsg)

            override fun onCloseWindow(window: WebView) {
                super.onCloseWindow(window)
                destroyTargetForWebView(window)
            }

            override fun onReceivedTitle(view: WebView, title: String?) {
                super.onReceivedTitle(view, title)
                emitTargetTitle(targetId, title)
            }
        }
    }

    private fun destroyTargetForWebView(window: WebView) {
        val targetId = targets.entries.firstOrNull { it.value === window }?.key ?: return
        destroyTarget(
            JSONObject().apply {
                put("targetId", targetId)
            }
        )
    }

    private fun String.normalizeTargetUrl(): String =
        trim().let { value ->
            if (value.matches(Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:.*"))) value else "https://$value"
        }
}
