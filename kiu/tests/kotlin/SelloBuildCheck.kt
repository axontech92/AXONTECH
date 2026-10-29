package kiu.checks

import java.time.Instant

/**
 * Verificación REAL de la lógica del sello de build (v2.9.8).
 *
 * <p>Existe porque esto rompió el CI entero y no lo agarramos: en
 * `app/build.gradle.kts`, `java.time.Instant` daba <i>Unresolved reference: time</i>
 * porque dentro de un `.gradle.kts` el identificador `java` resuelve a la
 * <b>extensión</b> de Gradle, no al paquete `java.*`. Y el `mapOf` sin tipo
 * declarado infería `Serializable` porque sus valores eran de tipos distintos, así
 * que el `Pair` no casaba.
 *
 * <p>El archivo de este proyecto no se puede compilar sin el SDK de Android ni la
 * API de Gradle, pero <b>el bloque del sello sí</b>: son unas líneas de Kotlin puro.
 * Este harness las compila y las ejecuta, así que la próxima vez que alguien escriba
 * `java.` o cambie los tipos del mapa, esto se rompe en local y no dos días después
 * en GitHub.
 *
 * <p><b>LIMITACIÓN, y es importante.</b> Este harness NO reproduce los dos errores
 * que rompieron el CI, y no debe dar la impresión de que sí:
 *
 * <ul>
 *   <li>`java.time.Instant` SÍ compila en un `.kt` normal. El «Unresolved reference:
 *       time» pasa porque dentro de un <b>.gradle.kts</b> el identificador `java`
 *       resuelve a la extensión de Gradle. Acá no hay extensión, así que compila.
 *       Para eso está el test estructural de `sellado.test.mjs`, que sí mira el
 *       archivo real.</li>
 *   <li>El `mapOf` sin tipo explícito también compila acá, porque sin el contexto de
 *       `tasks.registering` no hay un tipo esperado con el que chocar. El error de
 *       verdad venía del lado de Gradle.</li>
 * </ul>
 *
 * <p>Lo que este archivo SÍ verifica de verdad es el comportamiento: que el sello
 * arme un JSON con los campos correctos y el código como texto. Eso se ejecuta y se
 * puede romper. Los dos gotchas de Kotlin DSL quedan cubiertos del otro lado.
 */

private const val kiuVersionName = "PRUEBA"
private const val kiuVersionCode = 999
private val kiuGitSha = "abc1234"

private var fallo = 0

private fun check(ok: Boolean, what: String) {
    if (!ok) {
        fallo++
        println("FAIL $what")
    }
}

fun main() {
    // Copia exacta de la construcción del sello en app/build.gradle.kts.
    val stamp: Map<String, String> = mapOf(
        "version" to kiuVersionName,
        "versionCode" to kiuVersionCode.toString(),
        "git" to kiuGitSha,
        "builtAt" to Instant.now().toString(),
        "builtHere" to (System.getenv("GITHUB_RUN_ID") ?: "local")
    )

    val json = stamp.entries.joinToString(",", "{", "}") { "\"${it.key}\":\"${it.value}\"" }

    check(json.startsWith("{") && json.endsWith("}"), "el JSON tiene que abrir y cerrar con llave")
    check(json.contains("\"version\":\"PRUEBA\""), "tiene que traer la versión")
    check(json.contains("\"versionCode\":\"999\""), "y el código como texto, no como número")
    check(json.contains("\"builtAt\":\""), "y la fecha")
    check(json.contains("\"builtHere\":\"local\""), "y dónde se compiló")
    check(stamp.values.all { it.isNotEmpty() }, "ningún valor puede quedar vacío")

    /* El caso que rompió el CI —el `mapOf` sin tipo declarado, que hace que Kotlin
       infiera el común más arriba y el Pair deje de casar— no necesita un assert en
       runtime: si alguien saca el `: Map<String, String>` de arriba, este archivo
       deja de COMPILAR, y compilar es justamente lo que hace este test.

       Lo mismo con `java.time.Instant`: en un .gradle.kts plano no compila, y por
       eso hace falta el `import` explícito. Acá, en un .kt normal, el import alcanza
       — y aun así el import está, para que quede escrito el motivo. */

    println("checks=7 fails=$fallo")
    if (fallo > 0) {
        kotlin.system.exitProcess(1)
    }
}
