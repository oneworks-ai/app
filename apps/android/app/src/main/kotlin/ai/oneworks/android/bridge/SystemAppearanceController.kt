package ai.oneworks.android.bridge

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.view.View
import android.view.WindowInsetsController
import org.json.JSONObject
import java.util.Locale

class SystemAppearanceController(
    private val activity: Activity,
    private val rootView: View
) {
    fun setAppearance(params: JSONObject): JSONObject {
        val theme = params.optString("theme", "light").lowercase(Locale.ROOT)
        val dark = theme == "dark"
        apply(dark)
        return JSONObject().apply {
            put("theme", if (dark) "dark" else "light")
            put("systemBars", true)
        }
    }

    fun apply(dark: Boolean) {
        val background = if (dark) Color.rgb(20, 20, 20) else Color.WHITE
        rootView.setBackgroundColor(background)
        @Suppress("DEPRECATION")
        activity.window.statusBarColor = background
        @Suppress("DEPRECATION")
        activity.window.navigationBarColor = background
        setSystemBarIconAppearance(dark)
    }

    private fun setSystemBarIconAppearance(dark: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val lightSystemBars = if (dark) {
                0
            } else {
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            }
            activity.window.insetsController?.setSystemBarsAppearance(
                lightSystemBars,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
            return
        }

        @Suppress("DEPRECATION")
        var flags = activity.window.decorView.systemUiVisibility
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            @Suppress("DEPRECATION")
            flags = if (dark) {
                flags and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
            } else {
                flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            @Suppress("DEPRECATION")
            flags = if (dark) {
                flags and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
            } else {
                flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            }
        }
        @Suppress("DEPRECATION")
        activity.window.decorView.systemUiVisibility = flags
    }
}
