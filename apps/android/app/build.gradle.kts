import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.security.MessageDigest

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val generatedAssetsDir = layout.buildDirectory.dir("generated/assets/oneworks")
val repositoryRoot = rootProject.layout.projectDirectory.asFile.parentFile.parentFile
val runtimePackageCacheVersionPattern = Regex("^[0-9A-Za-z._+-]+$")

fun sha256Text(value: String): String =
    MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

fun normalizeRuntimePackageCacheVersion(value: String?): String? {
    val normalized = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    require(
        runtimePackageCacheVersionPattern.matches(normalized) &&
            normalized != "." &&
            normalized != ".."
    ) {
        "Invalid runtime package cache version: $normalized"
    }
    return normalized
}

val requestedGradleTasks = providers.provider {
    gradle.startParameter.taskNames.joinToString(" ").lowercase()
}
val defaultDebugRuntimePackageCacheVersion = requestedGradleTasks.map { tasks ->
    if (tasks.contains("debug")) {
        "dev-${sha256Text(repositoryRoot.absolutePath).take(12)}"
    } else {
        ""
    }
}
val runtimePackageCacheVersionProvider = providers.gradleProperty("oneworksRuntimePackageCacheVersion")
    .orElse(providers.gradleProperty("oneworksAndroidRuntimePackageCacheVersion"))
    .orElse(providers.environmentVariable("ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION"))
    .orElse(providers.environmentVariable("__ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__"))
    .orElse(providers.environmentVariable("ONEWORKS_ANDROID_RUNTIME_PACKAGE_CACHE_VERSION"))
    .orElse(defaultDebugRuntimePackageCacheVersion)

val syncClientDist by tasks.registering(Sync::class) {
    val clientDist = rootProject.layout.projectDirectory.dir("../client/dist")
    onlyIf {
        clientDist.asFile.resolve("index.html").isFile
    }
    from(clientDist)
    into(generatedAssetsDir.map { it.dir("client") })
}
val syncServerDist by tasks.registering(Sync::class) {
    val serverProject = rootProject.layout.projectDirectory.dir("../server")
    val serverDist = rootProject.layout.projectDirectory.dir("../server/dist")
    onlyIf {
        serverProject.asFile.resolve("package.json").isFile
    }
    from(serverProject) {
        include("cli.js")
        include("package.json")
        include("src/**")
        into("source")
    }
    if (serverDist.asFile.isDirectory) {
        from(serverDist) {
            into("dist")
        }
    }
    into(generatedAssetsDir.map { it.dir("server") })
}
val generateRuntimePackageCacheMetadata by tasks.registering {
    val outputFile = generatedAssetsDir.map { it.file("runtime/package-cache.json") }
    val androidPackageJson = rootProject.layout.projectDirectory.file("package.json")
    val clientPackageJson = rootProject.layout.projectDirectory.file("../client/package.json")
    val serverPackageJson = rootProject.layout.projectDirectory.file("../server/package.json")

    inputs.property("runtimePackageCacheVersion", runtimePackageCacheVersionProvider)
    inputs.files(androidPackageJson, clientPackageJson, serverPackageJson)
    outputs.file(outputFile)

    fun readPackageVersion(packageFile: File): String? {
        if (!packageFile.isFile) return null
        val parsed = JsonSlurper().parse(packageFile) as? Map<*, *> ?: return null
        return (parsed["version"] as? String)?.trim()?.takeIf { it.isNotEmpty() }
    }

    doLast {
        val cacheVersion = normalizeRuntimePackageCacheVersion(runtimePackageCacheVersionProvider.orNull)
        val packages = linkedMapOf<String, Map<String, String>>()
        for ((packageName, packageFile) in listOf(
            "@oneworks/android" to androidPackageJson.asFile,
            "@oneworks/client" to clientPackageJson.asFile,
            "@oneworks/server" to serverPackageJson.asFile
        )) {
            val packageVersion = readPackageVersion(packageFile) ?: continue
            packages[packageName] = linkedMapOf<String, String>().apply {
                put("version", packageVersion)
                if (cacheVersion != null) {
                    put("cacheVersion", cacheVersion)
                }
            }
        }

        val metadata = linkedMapOf<String, Any>(
            "schemaVersion" to 1,
            "source" to "android",
            "packages" to packages
        )
        if (cacheVersion != null) {
            metadata["cacheVersion"] = cacheVersion
        }

        val file = outputFile.get().asFile
        file.parentFile.mkdirs()
        file.writeText("${JsonOutput.prettyPrint(JsonOutput.toJson(metadata))}\n")
    }
}

android {
    namespace = "ai.oneworks.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.oneworks.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets.getByName("main") {
        assets.srcDir(generatedAssetsDir)
    }
}

kotlin {
    jvmToolchain(17)
}

tasks.named("preBuild") {
    dependsOn(syncClientDist, syncServerDist, generateRuntimePackageCacheMetadata)
}
