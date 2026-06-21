package ai.oneworks.android.accessibility

import ai.oneworks.android.bridge.BridgeJson
import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject
import java.util.Locale

class AccessibilityActions(private val context: Context) {
    fun status() = JSONObject().apply {
        val service = OneWorksAccessibilityService.active
        put("enabled", service != null)
        put("canReadActiveWindow", service?.rootInActiveWindow != null)
    }

    fun openSettings() = status().apply {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        put("openedSettings", true)
    }

    fun clickByText(params: JSONObject): JSONObject {
        val text = BridgeJson.requireString(params, "text")
        val node = findNode(text)
        return JSONObject().apply {
            put("text", text)
            put("clicked", node.performClickUpTree())
        }
    }

    fun setTextByText(params: JSONObject): JSONObject {
        val text = BridgeJson.requireString(params, "text")
        val value = params.optString("value", "")
        val node = findNode(text)
        val arguments = Bundle().apply {
            putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                value
            )
        }

        return JSONObject().apply {
            put("text", text)
            put("value", value)
            put("updated", node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments))
        }
    }

    fun performGlobalAction(params: JSONObject): JSONObject {
        val action = BridgeJson.requireString(params, "action")
        val service = requireService()
        return JSONObject().apply {
            put("action", action)
            put("performed", service.performGlobalAction(action.toGlobalAction()))
        }
    }

    private fun requireService(): OneWorksAccessibilityService =
        OneWorksAccessibilityService.active
            ?: error("OneWorks accessibility service is not enabled.")

    private fun findNode(text: String): AccessibilityNodeInfo {
        val root = requireService().rootInActiveWindow
            ?: error("No active accessibility window.")
        root.findAccessibilityNodeInfosByText(text)
            .firstOrNull { it?.isVisibleToUser == true }
            ?.let { return it }
        root.findByContentDescription(text)?.let { return it }
        throw IllegalArgumentException("No visible accessibility node matched: $text")
    }

    private fun AccessibilityNodeInfo.findByContentDescription(text: String): AccessibilityNodeInfo? {
        val normalizedText = text.lowercase(Locale.ROOT)
        val description = contentDescription?.toString()?.lowercase(Locale.ROOT)
        if (description?.contains(normalizedText) == true && isVisibleToUser) {
            return this
        }

        for (index in 0 until childCount) {
            val match = getChild(index)?.findByContentDescription(text)
            if (match != null) return match
        }
        return null
    }

    private fun AccessibilityNodeInfo.performClickUpTree(): Boolean {
        var current: AccessibilityNodeInfo? = this
        while (current != null) {
            if (current.isClickable && current.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                return true
            }
            current = current.parent
        }
        return performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    private fun String.toGlobalAction() = when (this) {
        "back" -> AccessibilityService.GLOBAL_ACTION_BACK
        "home" -> AccessibilityService.GLOBAL_ACTION_HOME
        "notifications" -> AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
        "recents" -> AccessibilityService.GLOBAL_ACTION_RECENTS
        else -> throw IllegalArgumentException("Unsupported accessibility global action: $this")
    }
}
