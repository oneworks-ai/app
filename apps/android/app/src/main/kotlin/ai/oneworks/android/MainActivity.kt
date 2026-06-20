package ai.oneworks.android

import ai.oneworks.android.accessibility.AccessibilityActions
import ai.oneworks.android.bridge.AndroidLocalBackend
import ai.oneworks.android.bridge.BundledAssetLoader
import ai.oneworks.android.bridge.DeviceWorkspaceController
import ai.oneworks.android.bridge.HostBridge
import ai.oneworks.android.bridge.NativeEventDispatcher
import ai.oneworks.android.bridge.SystemAppearanceController
import ai.oneworks.android.bridge.TargetWebViewManager
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Insets
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.window.OnBackInvokedDispatcher

class MainActivity : Activity() {
    private lateinit var hostWebView: WebView
    private lateinit var targetWebViews: TargetWebViewManager
    private lateinit var deviceWorkspaces: DeviceWorkspaceController

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(true)
        val assetLoader = BundledAssetLoader(this).also { it.installServiceWorkerClient() }

        val root = LinearLayout(this).apply {
            setBackgroundColor(Color.rgb(248, 250, 252))
            orientation = LinearLayout.VERTICAL
        }
        applySystemBarInsets(root)
        val systemAppearance = SystemAppearanceController(this, root)
        val targetContainer = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(17, 24, 39))
            visibility = View.GONE
        }
        hostWebView = createHostWebView(assetLoader)

        root.addView(
            hostWebView,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        )
        root.addView(
            targetContainer,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        )
        setContentView(root)
        systemAppearance.apply(isSystemDarkTheme())
        root.post { root.requestApplyInsets() }

        val dispatcher = NativeEventDispatcher(hostWebView)
        targetWebViews = TargetWebViewManager(this, targetContainer, dispatcher, assetLoader)
        deviceWorkspaces = DeviceWorkspaceController(this, dispatcher)
        assetLoader.localBackend = AndroidLocalBackend(deviceWorkspaces)
        hostWebView.addJavascriptInterface(
            HostBridge(
                dispatcher = dispatcher,
                targetWebViews = targetWebViews,
                accessibilityActions = AccessibilityActions(this),
                deviceWorkspaces = deviceWorkspaces,
                systemAppearance = systemAppearance
            ),
            "OneWorksAndroidBridge"
        )
        hostWebView.loadUrl(
            if (assetLoader.hasBundledClient()) {
                BundledAssetLoader.CLIENT_ENTRY_URL
            } else {
                BundledAssetLoader.DEMO_HOST_URL
            }
        )
        registerBackNavigation()
    }

    @Deprecated("Directory picker results still use the platform Activity result callback.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (deviceWorkspaces.handleActivityResult(requestCode, resultCode, data)) {
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun isSystemDarkTheme(): Boolean =
        resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
            Configuration.UI_MODE_NIGHT_YES

    private fun applySystemBarInsets(root: View) {
        val initialLeft = root.paddingLeft
        val initialTop = root.paddingTop
        val initialRight = root.paddingRight
        val initialBottom = root.paddingBottom

        root.setOnApplyWindowInsetsListener { view, insets ->
            val left: Int
            val top: Int
            val right: Int
            val bottom: Int
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val systemBars = insets.getInsets(WindowInsets.Type.systemBars())
                left = systemBars.left
                top = systemBars.top
                right = systemBars.right
                bottom = systemBars.bottom
            } else {
                @Suppress("DEPRECATION")
                left = insets.systemWindowInsetLeft
                @Suppress("DEPRECATION")
                top = insets.systemWindowInsetTop
                @Suppress("DEPRECATION")
                right = insets.systemWindowInsetRight
                @Suppress("DEPRECATION")
                bottom = insets.systemWindowInsetBottom
            }

            view.setPadding(
                initialLeft + left,
                initialTop + top,
                initialRight + right,
                initialBottom + bottom
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsets.Builder(insets)
                    .setInsets(WindowInsets.Type.systemBars(), Insets.NONE)
                    .setInsets(WindowInsets.Type.displayCutout(), Insets.NONE)
                    .build()
            } else {
                insets
            }
        }
    }

    @Deprecated("Android 13+ routes back through OnBackInvokedDispatcher.")
    override fun onBackPressed() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return
        }
        handleBackNavigation()
    }

    private fun registerBackNavigation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                ::handleBackNavigation
            )
        }
    }

    private fun handleBackNavigation() {
        when {
            targetWebViews.goBackIfPossible() -> Unit
            hostWebView.canGoBack() -> hostWebView.goBack()
            else -> finish()
        }
    }

    override fun onDestroy() {
        targetWebViews.destroyAll()
        hostWebView.destroy()
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createHostWebView(assetLoader: BundledAssetLoader) = WebView(this).apply {
        settings.javaScriptEnabled = true
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.domStorageEnabled = true
        settings.loadWithOverviewMode = true
        settings.setSupportMultipleWindows(true)
        settings.useWideViewPort = true
        webViewClient = object : WebViewClient() {
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
            ): Boolean {
                if (!::targetWebViews.isInitialized) return false
                return targetWebViews.createWindow(resultMsg)
            }
        }
    }
}
