package ai.oneworks.android.bridge

interface BridgeCallback {
    fun resolve(result: Any?)

    fun reject(code: String, message: String?)
}
