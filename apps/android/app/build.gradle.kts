plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val generatedAssetsDir = layout.buildDirectory.dir("generated/assets/oneworks")
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
    dependsOn(syncClientDist, syncServerDist)
}
