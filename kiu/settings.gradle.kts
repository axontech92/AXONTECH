// KIU — proyecto Gradle real (migración desde el flujo apktool)
// Módulo único: app (Java, sin dependencias externas salvo las declaradas aquí)
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "Kiu"
include(":app")
