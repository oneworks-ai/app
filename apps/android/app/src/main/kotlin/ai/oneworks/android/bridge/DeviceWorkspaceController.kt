package ai.oneworks.android.bridge

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

class DeviceWorkspaceController(
    private val activity: Activity,
    private val dispatcher: NativeEventDispatcher
) {
    companion object {
        const val CHOOSE_WORKSPACE_REQUEST_CODE = 4107
        private const val MAX_RECENT_WORKSPACES = 20
        private const val PREFS_NAME = "oneworks_device_workspaces"
        private const val PREFS_ACTIVE_WORKSPACE = "active_workspace"
        private const val PREFS_RECENT_WORKSPACES = "recent_workspaces"
        private val INVALID_FILE_NAME_CHARACTERS = setOf('<', '>', ':', '"', '/', '\\', '|', '?', '*')
    }

    private var pendingChooseWorkspace: BridgeCallback? = null

    fun getWorkspaceSelectorState(): JSONObject =
        buildWorkspaceSelectorState()

    fun getActiveWorkspace(): JSONObject? =
        readActiveWorkspace()?.toJson()

    fun listWorkspaceDirectories(params: JSONObject): JSONObject {
        val currentDirectory = resolveDirectory(
            params.optString("directory", "").trim()
        )
        val directories = listChildDirectories(currentDirectory)
        return JSONObject()
            .put("currentDirectory", currentDirectory.absolutePath)
            .put("directories", JSONArray().apply {
                for (directory in directories) {
                    put(
                        JSONObject()
                            .put("name", directory.name)
                            .put("path", directory.absolutePath)
                    )
                }
            })
            .apply {
                val parentDirectory = currentDirectory.parentFile
                if (
                    parentDirectory != null &&
                    currentDirectory.absolutePath != storageRoot().absolutePath &&
                    currentDirectory.absolutePath != parentDirectory.absolutePath
                ) {
                    put("parentDirectory", parentDirectory.absolutePath)
                }
            }
    }

    fun chooseWorkspace(callback: BridgeCallback) {
        if (pendingChooseWorkspace != null) {
            callback.reject("workspace_picker_busy", "A workspace picker is already open.")
            return
        }

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
        }
        pendingChooseWorkspace = callback
        runCatching {
            activity.startActivityForResult(intent, CHOOSE_WORKSPACE_REQUEST_CODE)
        }.onFailure { error ->
            pendingChooseWorkspace = null
            callback.reject("workspace_picker_failed", error.message)
        }
    }

    fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != CHOOSE_WORKSPACE_REQUEST_CODE) return false

        val callback = pendingChooseWorkspace
        pendingChooseWorkspace = null
        if (callback == null) return true

        if (resultCode != Activity.RESULT_OK) {
            callback.resolve(null)
            return true
        }

        val uri = data?.data
        if (uri == null) {
            callback.resolve(null)
            return true
        }

        persistTreePermission(uri, data.flags)
        callback.resolve(createWorkspaceRecord(uri.toString()).toJson())
        return true
    }

    fun openWorkspace(params: JSONObject): JSONObject {
        val workspaceFolder = BridgeJson.requireString(params, "workspaceFolder")
        val record = createWorkspaceRecord(workspaceFolder)
        val workspaces = listRecentWorkspaces()
            .filter { it.workspaceFolder != record.workspaceFolder }
            .toMutableList()
        workspaces.add(0, record)
        saveRecentWorkspaces(workspaces.take(MAX_RECENT_WORKSPACES))
        saveActiveWorkspace(record)
        emitWorkspaceSelectorState()
        return record.toJson()
    }

    fun createWorkspaceInDirectory(params: JSONObject): JSONObject {
        val parentDirectory = requireExistingDirectory(params, "parentDirectory")
        val projectName = requireValidProjectName(params)
        val workspaceDirectory = File(parentDirectory, projectName).normalized()
        if (workspaceDirectory.parentFile?.normalized()?.absolutePath != parentDirectory.absolutePath) {
            throw JSONException("A valid project name is required.")
        }
        if (!workspaceDirectory.mkdir()) {
            throw JSONException("Failed to create workspace directory.")
        }
        return JSONObject()
            .put("workspaceFolder", workspaceDirectory.absolutePath)
    }

    fun forgetWorkspace(params: JSONObject): JSONObject {
        val workspaceFolder = BridgeJson.requireString(params, "workspaceFolder")
        val workspaces = listRecentWorkspaces()
            .filter { it.workspaceFolder != workspaceFolder }
        saveRecentWorkspaces(workspaces)
        if (readActiveWorkspace()?.workspaceFolder == workspaceFolder) {
            clearActiveWorkspace()
        }
        emitWorkspaceSelectorState()
        return JSONObject()
            .put("ok", true)
            .put("workspaceFolder", workspaceFolder)
    }

    fun stopWorkspace(params: JSONObject): JSONObject {
        val workspaceFolder = BridgeJson.requireString(params, "workspaceFolder")
        val forget = params.optBoolean("forget", false)
        if (forget) {
            forgetWorkspace(params)
        }
        return JSONObject()
            .put("ok", true)
            .put("removed", forget)
            .put("stopped", false)
            .put("workspaceFolder", workspaceFolder)
    }

    private fun persistTreePermission(uri: Uri, flags: Int) {
        val permissionFlags = flags and (
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
        if (permissionFlags == 0) return

        runCatching {
            activity.contentResolver.takePersistableUriPermission(uri, permissionFlags)
        }
    }

    private fun resolveDirectory(rawDirectory: String): File {
        if (rawDirectory.isEmpty()) return storageRoot()

        val candidate = File(rawDirectory)
        if (!candidate.isDirectory) return storageRoot()
        return candidate.normalized()
    }

    private fun requireExistingDirectory(params: JSONObject, key: String): File {
        val rawDirectory = BridgeJson.requireString(params, key)
        val directory = File(rawDirectory).normalized()
        if (!directory.isDirectory) {
            throw JSONException("A valid parent directory is required.")
        }
        return directory
    }

    private fun requireValidProjectName(params: JSONObject): String {
        val projectName = BridgeJson.requireString(params, "projectName")
        if (
            projectName == "." ||
            projectName == ".." ||
            projectName.any { character ->
                character in INVALID_FILE_NAME_CHARACTERS || character.code == 0
            }
        ) {
            throw JSONException("A valid project name is required.")
        }
        return projectName
    }

    private fun listChildDirectories(directory: File): List<File> {
        val directChildren = directory
            .listFiles { file -> file.isDirectory && !file.name.startsWith(".") }
            ?.map { it.normalized() }
            ?.sortedBy { it.name.lowercase() }
        if (directChildren != null) return directChildren

        if (directory.absolutePath != storageRoot().absolutePath) return emptyList()

        return standardPublicDirectories()
            .filter { it.isDirectory }
            .map { it.normalized() }
            .distinctBy { it.absolutePath }
            .sortedBy { it.name.lowercase() }
    }

    private fun storageRoot(): File =
        Environment.getExternalStorageDirectory().normalized()

    private fun standardPublicDirectories(): List<File> =
        listOf(
            Environment.DIRECTORY_ALARMS,
            Environment.DIRECTORY_DCIM,
            Environment.DIRECTORY_DOCUMENTS,
            Environment.DIRECTORY_DOWNLOADS,
            Environment.DIRECTORY_MOVIES,
            Environment.DIRECTORY_MUSIC,
            Environment.DIRECTORY_NOTIFICATIONS,
            Environment.DIRECTORY_PICTURES,
            Environment.DIRECTORY_PODCASTS,
            Environment.DIRECTORY_RINGTONES
        ).map { directoryType ->
            Environment.getExternalStoragePublicDirectory(directoryType)
        }

    private fun File.normalized(): File =
        runCatching { canonicalFile }.getOrDefault(absoluteFile)

    private fun emitWorkspaceSelectorState() {
        dispatcher.emit("device.workspaceSelectorStateChange", buildWorkspaceSelectorState())
    }

    private fun buildWorkspaceSelectorState(): JSONObject =
        JSONObject()
            .put("recentProjects", JSONArray().apply {
                for (workspace in listRecentWorkspaces()) {
                    put(workspace.toJson())
                }
            })
            .put("runningProjects", JSONArray().apply {
                readActiveWorkspace()?.let { workspace ->
                    put(workspace.toJson().put("status", "ready"))
                }
            })

    private fun listRecentWorkspaces(): List<DeviceWorkspaceRecord> {
        val rawValue = preferences().getString(PREFS_RECENT_WORKSPACES, "[]") ?: "[]"
        return runCatching {
            val array = JSONArray(rawValue)
            buildList {
                for (index in 0 until array.length()) {
                    val item = array.optJSONObject(index) ?: continue
                    val workspaceFolder = item.optString("workspaceFolder", "").trim()
                    if (workspaceFolder.isEmpty()) continue
                    add(
                        DeviceWorkspaceRecord(
                            description = item.optString("description", workspaceFolder),
                            name = item.optString("name", workspaceFolder).ifEmpty {
                                resolveWorkspaceName(workspaceFolder)
                            },
                            workspaceFolder = workspaceFolder,
                            workspaceId = item.optString("workspaceId", "").ifEmpty {
                                createWorkspaceId(workspaceFolder)
                            }
                        )
                    )
                }
            }
        }.getOrDefault(emptyList())
    }

    private fun saveRecentWorkspaces(workspaces: List<DeviceWorkspaceRecord>) {
        val array = JSONArray().apply {
            for (workspace in workspaces) {
                put(workspace.toJson())
            }
        }
        preferences()
            .edit()
            .putString(PREFS_RECENT_WORKSPACES, array.toString())
            .apply()
    }

    private fun readActiveWorkspace(): DeviceWorkspaceRecord? {
        val rawValue = preferences().getString(PREFS_ACTIVE_WORKSPACE, null) ?: return null
        return runCatching {
            val item = JSONObject(rawValue)
            val workspaceFolder = item.optString("workspaceFolder", "").trim()
            if (workspaceFolder.isEmpty()) return@runCatching null
            DeviceWorkspaceRecord(
                description = item.optString("description", workspaceFolder),
                name = item.optString("name", workspaceFolder).ifEmpty {
                    resolveWorkspaceName(workspaceFolder)
                },
                workspaceFolder = workspaceFolder,
                workspaceId = item.optString("workspaceId", "").ifEmpty {
                    createWorkspaceId(workspaceFolder)
                }
            )
        }.getOrNull()
    }

    private fun saveActiveWorkspace(workspace: DeviceWorkspaceRecord) {
        preferences()
            .edit()
            .putString(PREFS_ACTIVE_WORKSPACE, workspace.toJson().toString())
            .apply()
    }

    private fun clearActiveWorkspace() {
        preferences()
            .edit()
            .remove(PREFS_ACTIVE_WORKSPACE)
            .apply()
    }

    private fun createWorkspaceRecord(workspaceFolder: String): DeviceWorkspaceRecord =
        DeviceWorkspaceRecord(
            description = workspaceFolder,
            name = resolveWorkspaceName(workspaceFolder),
            workspaceFolder = workspaceFolder,
            workspaceId = createWorkspaceId(workspaceFolder)
        )

    private fun resolveWorkspaceName(workspaceFolder: String): String {
        val uriName = runCatching {
            val uri = Uri.parse(workspaceFolder)
            if (uri.scheme == "content") queryTreeDisplayName(uri) else null
        }.getOrNull()
        if (!uriName.isNullOrBlank()) return uriName

        val trimmedPath = workspaceFolder.trim().trimEnd('/', '\\')
        val pathName = trimmedPath
            .substringAfterLast('/')
            .substringAfterLast('\\')
            .substringAfterLast(':')
            .trim()
        return pathName.ifEmpty { workspaceFolder }
    }

    private fun queryTreeDisplayName(uri: Uri): String? {
        val documentId = DocumentsContract.getTreeDocumentId(uri)
        val documentUri = DocumentsContract.buildDocumentUriUsingTree(uri, documentId)
        return activity.contentResolver.query(
            documentUri,
            arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
            null,
            null,
            null
        )?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            cursor.getString(0)
        }
    }

    private fun createWorkspaceId(workspaceFolder: String): String {
        val bytes = MessageDigest.getInstance("SHA-1")
            .digest(workspaceFolder.toByteArray(Charsets.UTF_8))
        return "android-" + bytes.take(10).joinToString("") { byte -> "%02x".format(byte) }
    }

    private fun preferences() =
        activity.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE)

    private data class DeviceWorkspaceRecord(
        val description: String,
        val name: String,
        val workspaceFolder: String,
        val workspaceId: String
    ) {
        fun toJson(): JSONObject =
            JSONObject()
                .put("description", description)
                .put("name", name)
                .put("workspaceFolder", workspaceFolder)
                .put("workspaceId", workspaceId)
    }
}
