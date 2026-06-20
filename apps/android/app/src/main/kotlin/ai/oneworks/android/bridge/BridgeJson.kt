package ai.oneworks.android.bridge

import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

object BridgeJson {
    fun requireString(json: JSONObject, key: String): String {
        val value = json.optString(key, "").trim()
        if (value.isEmpty()) {
            throw JSONException("Missing required string: $key")
        }
        return value
    }

    fun optionalString(json: JSONObject, key: String, fallback: String): String =
        json.optString(key, "").trim().ifEmpty { fallback }

    fun optionalObject(json: JSONObject, key: String): JSONObject =
        json.optJSONObject(key) ?: JSONObject()

    fun parseEvaluateResult(rawValue: String?): Any? {
        if (rawValue == null || rawValue == "null") return JSONObject.NULL
        return runCatching { JSONTokener(rawValue).nextValue() }.getOrDefault(rawValue)
    }

    fun jsonValue(value: Any?): Any = value ?: JSONObject.NULL
}
