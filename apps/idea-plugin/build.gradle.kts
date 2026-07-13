import org.gradle.api.DefaultTask
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.TaskAction
import org.gradle.jvm.toolchain.JavaLanguageVersion

plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.14.0"
}

abstract class ValidatePluginMetadataTask : DefaultTask() {
    @get:InputFile
    abstract val pluginXmlFile: RegularFileProperty

    @get:Input
    abstract val expectedPluginVersion: Property<String>

    @TaskAction
    fun validate() {
        val pluginXml = pluginXmlFile.get().asFile.readText()
        val pluginXmlVersion = Regex("<version>\\s*([^<]+)\\s*</version>")
            .find(pluginXml)
            ?.groupValues
            ?.get(1)
            ?.trim()

        check(pluginXmlVersion == expectedPluginVersion.get()) {
            "plugin.xml version ($pluginXmlVersion) must match package.json version (${expectedPluginVersion.get()})."
        }
    }
}

fun readPackageVersion(): String {
    val packageJson = layout.projectDirectory.file("package.json").asFile.readText()
    val match = Regex("\\\"version\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"").find(packageJson)
    return match?.groupValues?.get(1) ?: error("Unable to read version from package.json")
}

group = "ai.oneworks"
version = readPackageVersion()

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

repositories {
    mavenCentral()

    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdea("2024.3.6")
    }
}

tasks {
    withType<JavaCompile> {
        sourceCompatibility = "21"
        targetCompatibility = "21"
        options.encoding = "UTF-8"
    }
}

val validatePluginMetadata by tasks.registering(ValidatePluginMetadataTask::class) {
    pluginXmlFile.set(layout.projectDirectory.file("src/main/resources/META-INF/plugin.xml"))
    expectedPluginVersion.set(version.toString())
}

tasks.named("patchPluginXml") {
    dependsOn(validatePluginMetadata)
}
