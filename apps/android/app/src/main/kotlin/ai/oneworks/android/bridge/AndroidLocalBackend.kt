package ai.oneworks.android.bridge

import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.charset.StandardCharsets
import java.util.Locale

class AndroidLocalBackend(
    private val workspaces: DeviceWorkspaceController,
    private val runtimePackageCacheMetadata: JSONObject? = null
) {
    fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url ?: return null
        if (uri.host != "oneworks.local") return null

        val path = normalizePath(uri.path)
        if (!path.startsWith("/api/")) return null

        return handleRequest(path, request.method.uppercase(Locale.ROOT), uri)
    }

    private fun handleRequest(path: String, method: String, uri: Uri): WebResourceResponse {
        if (method == "OPTIONS") {
            return jsonResponse(JSONObject().put("ok", true))
        }

        if (path == "/api/auth/status" && method == "GET") {
            return jsonResponse(
                withRuntimePackageCacheMetadata(
                    JSONObject()
                        .put("enabled", false)
                        .put("authenticated", true)
                        .put("usernames", JSONArray().put("android"))
                        .put("passwordSource", "config")
                        .put("version", "android-local")
                )
            )
        }

        if (path == "/api/config" && method == "GET") {
            return jsonResponse(buildConfigResponse())
        }

        if (path == "/api/config" && method == "PATCH") {
            return jsonResponse(JSONObject().put("ok", true))
        }

        if (path == "/api/config/schema" && method == "GET") {
            return jsonResponse(JSONObject().put("sections", JSONArray()))
        }

        if (path == "/api/launcher/workspaces" && method == "GET") {
            return jsonResponse(workspaces.getWorkspaceSelectorState())
        }

        if (path == "/api/launcher/directories" && method == "GET") {
            return jsonResponse(
                workspaces.listWorkspaceDirectories(
                    JSONObject().put("directory", uri.getQueryParameter("directory") ?: "")
                )
            )
        }

        if ((path == "/api/sessions" || path == "/api/sessions/archived") && method == "GET") {
            return jsonResponse(JSONObject().put("sessions", JSONArray()))
        }

        if (path == "/api/sessions" && method == "POST") {
            return errorResponse(501, "android_backend_session_start_unavailable", "Android local backend cannot start agents yet.")
        }

        if ((path == "/api/agent-rooms" || path == "/api/agent-rooms/archived") && method == "GET") {
            return jsonResponse(JSONObject().put("rooms", JSONArray()))
        }

        if (path == "/api/worktree-environments" && method == "GET") {
            return jsonResponse(JSONObject().put("environments", JSONArray()))
        }

        if (path == "/api/workspace/panel-state" && method == "GET") {
            return jsonResponse(
                JSONObject()
                    .put("panelState", JSONObject())
                    .put("updatedAt", System.currentTimeMillis())
            )
        }

        if (path == "/api/workspace/panel-state" && method == "PATCH") {
            return jsonResponse(
                JSONObject()
                    .put("panelState", JSONObject())
                    .put("updatedAt", System.currentTimeMillis())
            )
        }

        if (path == "/api/workspace/file-openers" && method == "GET") {
            return jsonResponse(
                JSONObject()
                    .put("defaultOpener", "android")
                    .put("openers", JSONArray())
            )
        }

        if (path == "/api/workspace/path-actions" && method == "GET") {
            return jsonResponse(
                JSONObject()
                    .put(
                        "fileManager",
                        JSONObject()
                            .put("available", false)
                            .put("canRevealFile", false)
                            .put("kind", "android")
                            .put("title", "Android")
                    )
                    .put("terminalOpeners", JSONArray())
            )
        }

        if (path == "/api/workspace/tree" && method == "GET") {
            return listWorkspaceTree(uri.getQueryParameter("path"))
        }

        if (path == "/api/workspace/file" && method == "GET") {
            return readWorkspaceFile(uri.getQueryParameter("path"))
        }

        if (path == "/api/workspace/file" && method == "PUT") {
            return errorResponse(403, "android_backend_read_only", "Android local backend is read-only in this prototype.")
        }

        if (
            method == "POST" &&
            (path == "/api/workspace/open-file" || path == "/api/workspace/reveal-path" ||
                path == "/api/workspace/open-workspace")
        ) {
            return jsonResponse(
                JSONObject()
                    .put("ok", true)
                    .put("path", activeWorkspaceFolder() ?: "")
            )
        }

        if (path == "/api/workspace/git" || Regex("/git(?:/|$)").containsMatchIn(path)) {
            return jsonResponse(
                JSONObject()
                    .put("available", false)
                    .put("cwd", activeWorkspaceFolder() ?: "")
                    .put("reason", "android_local_backend")
            )
        }

        if (Regex("^/api/adapters/[^/]+/accounts").containsMatchIn(path)) {
            return jsonResponse(
                JSONObject()
                    .put("defaultAccount", "android-local")
                    .put(
                        "accounts",
                        JSONArray().put(
                            JSONObject()
                                .put("key", "android-local")
                                .put("title", "Android local")
                                .put("status", "ready")
                                .put("isDefault", true)
                        )
                    )
            )
        }

        if (path == "/api/projects" && method == "GET") {
            return jsonResponse(JSONObject().put("projects", JSONArray()))
        }

        if (path == "/api/plugins" && method == "GET") {
            return jsonResponse(JSONObject().put("plugins", JSONArray()).put("diagnostics", JSONArray()))
        }

        if (path == "/api/plugins/marketplace/catalog" && method == "GET") {
            return jsonResponse(JSONObject().put("items", JSONArray()))
        }

        if (path == "/api/model-providers" && method == "GET") {
            return jsonResponse(JSONObject().put("providers", JSONArray()))
        }

        if (path.startsWith("/api/model-services/")) {
            return jsonResponse(JSONObject().put("status", "unavailable").put("models", JSONArray()))
        }

        if (path == "/api/voice/speech-to-text/services" && method == "GET") {
            return jsonResponse(JSONObject().put("services", JSONArray()))
        }

        if (path.startsWith("/api/ai/") && method == "GET") {
            return jsonResponse(JSONObject().put("items", JSONArray()).put("results", JSONArray()))
        }

        if (
            (path == "/api/module-updates" || path == "/api/module-updates/check") &&
            (method == "GET" || method == "POST")
        ) {
            return jsonResponse(
                withRuntimePackageCacheMetadata(
                    JSONObject()
                        .put("checkedAt", System.currentTimeMillis())
                        .put("channel", "stable")
                        .put("moduleChannels", JSONObject())
                        .put("modules", JSONArray())
                        .put("npmTag", "latest")
                )
            )
        }

        return errorResponse(404, "android_backend_route_not_implemented", "Android local backend has no route for $path.")
    }

    private fun buildConfigResponse(): JSONObject {
        val workspaceFolder = activeWorkspaceFolder() ?: ""
        val conversation = JSONObject().put("runCommands", JSONArray())
        val adapters = JSONObject().put("codex", JSONObject())
        val adapterBuiltinModels = JSONObject().put(
            "codex",
            JSONArray().put(
                JSONObject()
                    .put("value", "codex")
                    .put("title", "Codex")
                    .put("description", "Android local backend placeholder")
            )
        )
        val merged = JSONObject()
            .put("adapterBuiltinModels", adapterBuiltinModels)
            .put("adapters", adapters)
            .put("conversation", conversation)
            .put(
                "experiments",
                JSONObject()
                    .put("agentRoom", false)
                    .put("benchmark", false)
                    .put("sessionTimeline", false)
            )
            .put(
                "general",
                JSONObject()
                    .put("defaultAdapter", "codex")
                    .put("defaultModel", "codex")
                    .put("interfaceLanguage", Locale.getDefault().toLanguageTag())
                    .put("messageLinks", JSONObject().put("workspaceFileOpener", "android"))
                    .put("recommendedModels", JSONArray())
            )
            .put("models", JSONObject())

        val about = withRuntimePackageCacheMetadata(
            JSONObject()
                .put("version", "android-local")
                .put("platform", "android")
        )

        return JSONObject()
            .put(
                "sources",
                JSONObject()
                    .put("project", JSONObject().put("conversation", conversation))
                    .put("user", JSONObject())
                    .put("merged", merged)
            )
            .put(
                "resolvedSources",
                JSONObject()
                    .put("project", JSONObject().put("conversation", conversation))
                    .put("user", JSONObject())
            )
            .put(
                "meta",
                JSONObject()
                    .put("workspaceFolder", workspaceFolder)
                    .put(
                        "configPresent",
                        JSONObject()
                            .put("global", false)
                            .put("project", false)
                            .put("user", false)
                    )
                    .put(
                        "about",
                        about
                    )
            )
    }

    private fun listWorkspaceTree(rawPath: String?): WebResourceResponse {
        val root = activeWorkspaceRoot()
            ?: return jsonResponse(JSONObject().put("path", "").put("entries", JSONArray()))
        val directory = resolveWorkspacePath(root, rawPath)
            ?: return errorResponse(400, "android_backend_invalid_path", "Workspace path is outside the active project.")
        if (!directory.isDirectory) {
            return errorResponse(400, "android_backend_not_directory", "Workspace path is not a directory.")
        }

        val entries = JSONArray()
        directory.listFiles()
            ?.filter { !it.name.startsWith(".") }
            ?.sortedWith(compareBy<File> { !it.isDirectory }.thenBy { it.name.lowercase(Locale.ROOT) })
            ?.take(240)
            ?.forEach { file ->
                entries.put(toTreeEntry(root, file))
            }

        return jsonResponse(
            JSONObject()
                .put("path", relativeWorkspacePath(root, directory))
                .put("entries", entries)
        )
    }

    private fun readWorkspaceFile(rawPath: String?): WebResourceResponse {
        val root = activeWorkspaceRoot()
            ?: return errorResponse(404, "android_backend_no_workspace", "No Android workspace is active.")
        val file = resolveWorkspacePath(root, rawPath)
            ?: return errorResponse(400, "android_backend_invalid_path", "Workspace path is outside the active project.")
        if (!file.isFile) {
            return errorResponse(400, "android_backend_not_file", "Workspace path is not a file.")
        }
        if (file.length() > 1024 * 1024) {
            return errorResponse(413, "android_backend_file_too_large", "Android local backend only reads files up to 1 MiB.")
        }

        val content = runCatching {
            file.readBytes().toString(StandardCharsets.UTF_8)
        }.getOrElse { error ->
            return errorResponse(500, "android_backend_file_read_failed", error.message ?: "Failed to read file.")
        }

        return jsonResponse(
            JSONObject()
                .put("content", content)
                .put("encoding", "utf-8")
                .put("path", relativeWorkspacePath(root, file))
                .put("size", file.length())
        )
    }

    private fun activeWorkspaceFolder(): String? {
        val workspace = workspaces.getActiveWorkspace() ?: return null
        val workspaceFolder = workspace.optString("workspaceFolder", "").trim()
        return workspaceFolder.ifEmpty { null }
    }

    private fun activeWorkspaceRoot(): File? {
        val workspaceFolder = activeWorkspaceFolder() ?: return null
        if (workspaceFolder.startsWith("content://")) return null
        val root = File(workspaceFolder).normalized()
        return if (root.isDirectory) root else null
    }

    private fun resolveWorkspacePath(root: File, rawPath: String?): File? {
        val normalizedPath = rawPath
            ?.trim()
            ?.replace('\\', '/')
            ?.trimStart('/')
            .orEmpty()
        val file = if (normalizedPath.isEmpty()) root else File(root, normalizedPath)
        val normalizedFile = file.normalized()
        return if (normalizedFile.isInside(root)) normalizedFile else null
    }

    private fun toTreeEntry(root: File, file: File): JSONObject =
        JSONObject()
            .put("absolutePath", file.absolutePath)
            .put("isExternal", false)
            .put("name", file.name)
            .put("path", relativeWorkspacePath(root, file))
            .put("type", if (file.isDirectory) "directory" else "file")

    private fun relativeWorkspacePath(root: File, file: File): String {
        val rootPath = root.normalized().absolutePath.trimEnd(File.separatorChar)
        val filePath = file.normalized().absolutePath
        if (filePath == rootPath) return ""
        return filePath
            .removePrefix(rootPath)
            .trimStart(File.separatorChar)
            .replace(File.separatorChar, '/')
    }

    private fun normalizePath(path: String?): String {
        val normalizedPath = path?.trimEnd('/')?.ifEmpty { "/" } ?: "/"
        return normalizedPath
    }

    private fun File.normalized(): File =
        runCatching { canonicalFile }.getOrDefault(absoluteFile)

    private fun File.isInside(root: File): Boolean {
        val normalizedRoot = root.normalized()
        var current: File? = normalized()
        while (current != null) {
            if (current == normalizedRoot) return true
            current = current.parentFile
        }
        return false
    }

    private fun runtimePackageCacheVersion(): String? =
        runtimePackageCacheMetadata
            ?.optString("cacheVersion", "")
            ?.trim()
            ?.takeIf { it.isNotEmpty() }

    private fun runtimePackageCacheMetadataCopy(): JSONObject? =
        runtimePackageCacheMetadata?.let { JSONObject(it.toString()) }

    private fun withRuntimePackageCacheMetadata(body: JSONObject): JSONObject {
        val cacheVersion = runtimePackageCacheVersion()
        if (cacheVersion != null) {
            body.put("runtimePackageCacheVersion", cacheVersion)
        }
        val metadata = runtimePackageCacheMetadataCopy()
        if (metadata != null) {
            body.put("runtimePackageCache", metadata)
        }
        return body
    }

    private fun jsonResponse(body: JSONObject, statusCode: Int = 200): WebResourceResponse =
        WebResourceResponse(
            "application/json",
            "UTF-8",
            statusCode,
            if (statusCode >= 400) "Error" else "OK",
            mapOf(
                "Access-Control-Allow-Credentials" to "true",
                "Access-Control-Allow-Origin" to "https://oneworks.local",
                "Cache-Control" to "no-cache",
                "Content-Type" to "application/json; charset=utf-8"
            ),
            body.toString().toByteArray(StandardCharsets.UTF_8).inputStream()
        )

    private fun errorResponse(statusCode: Int, code: String, message: String): WebResourceResponse =
        jsonResponse(
            JSONObject()
                .put("success", false)
                .put(
                    "error",
                    JSONObject()
                        .put("code", code)
                        .put("message", message)
                ),
            statusCode
        )
}
