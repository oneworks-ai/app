package ai.oneworks.android.accessibility

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import java.lang.ref.WeakReference

class OneWorksAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() {
        super.onServiceConnected()
        activeReference = WeakReference(this)
    }

    override fun onUnbind(intent: Intent?): Boolean {
        activeReference = WeakReference(null)
        return super.onUnbind(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Command-driven for now; event streaming should be added once a product flow needs it.
    }

    override fun onInterrupt() {
        // The prototype does not start long-running speech or haptic feedback.
    }

    companion object {
        private var activeReference = WeakReference<OneWorksAccessibilityService?>(null)

        val active: OneWorksAccessibilityService?
            get() = activeReference.get()
    }
}
