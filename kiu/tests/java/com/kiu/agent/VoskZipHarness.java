package com.kiu.agent;

/**
 * Pruebas de {@link ZipInstall} contra el zip REAL de Vosk (v2.9.7).
 *
 * <p>La diferencia con los tests de regex que ya tiene el proyecto es que esto
 * <b>descomprime los 39 MB de verdad</b> y mira dónde quedaron. El fallo que está
 * detrás —quitar la carpeta raíz del zip— es exactamente el tipo de cosa que un
 * test de forma no ve: la forma del código puede ser correcta y el resultado
 *amlindo, porque el modelo termina un nivel más abajo de donde lo busca el motor.
 *
 * <p>Si el zip no está en {@code KIU_VOSK_ZIP}, los tests que lo necesitan se
 * saltan a la vista: no pasan en verde por no haber comprobado nada.
 */
public class VoskZipHarness {

    private static int checks = 0;
    private static int fails = 0;

    private static void check(boolean cond, String what) {
        checks++;
        if (!cond) {
            fails++;
            System.out.println("FAIL " + what);
        }
    }

    private static String zip() {
        String p = System.getenv("KIU_VOSK_ZIP");
        return (p == null || p.isEmpty()) ? "" : p;
    }

    public static void main(String[] args) {
        String z = zip();
        if (z.isEmpty()) {
            System.out.println("SKIP no hay KIU_VOSK_ZIP apuntando al zip de Vosk");
            System.out.println("checks=" + checks + " fails=0");
            return;
        }
        QuitaLaCarpetaRaiz(z);
        ZipSlip(z);
        SirveComoModelo(z);
        ReportaErrores(z);

        System.out.println("checks=" + checks + " fails=" + fails);
        if (fails > 0) {
            System.exit(1);
        }
    }

    private static java.io.File tmp(String tag) throws Exception {
        java.io.File f = java.nio.file.Files.createTempDirectory("kiu-zip-" + tag).toFile();
        f.deleteOnExit();
        return f;
    }

    /* El bug: sin quitar la carpeta raíz, el modelo queda en
       <dest>/vosk-model-small-es-0.42/am/final.mdl y el motor busca
       <dest>/am/final.mdl. Un nivel de diferencia, y el síntoma es «falta el
       modelo» con 60 MB en disco. */
    private static void QuitaLaCarpetaRaiz(String z) {
        try {
            java.io.File dest = tmp("raiz");
            ZipInstall.Result r = ZipInstall.extract(z, dest.getAbsolutePath(), null);
            check(r.ok, "la extracción tiene que terminar bien: " + r.err);
            check(ZipInstall.sirveComoModelo(dest.getAbsolutePath()),
                "el modelo tiene que quedar donde el motor lo busca, con la carpeta raíz quitada");
            check(!new java.io.File(dest, "vosk-model-small-es-0.42/am/final.mdl").exists(),
                "y NO puede quedar con la carpeta raíz adentro");
            check(r.files > 0, "tiene que haber extraído archivos: " + r.files);
            check(r.bytes > 0, "y bytes: " + r.bytes);
        } catch (Throwable th) {
            check(false, "excepción en QuitaLaCarpetaRaiz: " + th);
        }
    }

    /* Un zip con ../ tiene que ser cortado, no escrito fuera de la carpeta. */
    private static void ZipSlip(String z) {
        try {
            java.io.File zip = tmp("slip");
            java.util.zip.ZipOutputStream out =
                    new java.util.zip.ZipOutputStream(new java.io.FileOutputStream(new java.io.File(zip, "malo.zip")));
            out.putNextEntry(new java.util.zip.ZipEntry("raiz/bueno.txt"));
            out.write("ok".getBytes("UTF-8"));
            out.closeEntry();
            out.putNextEntry(new java.util.zip.ZipEntry("raiz/../../se-me-escapa.txt"));
            out.write("malo".getBytes("UTF-8"));
            out.closeEntry();
            out.close();

            java.io.File dest = tmp("slip-dest");
            ZipInstall.Result r = ZipInstall.extract(new java.io.File(zip, "malo.zip").getAbsolutePath(),
                dest.getAbsolutePath(), null);
            check(r.skipped > 0, "la entrada con ../ tiene que quedar contada como saltada");
            check(!new java.io.File(dest.getParentFile(), "se-me-escapa.txt").exists(),
                "y NUNCA escribirse fuera de la carpeta destino");
        } catch (Throwable th) {
            check(false, "excepción en ZipSlip: " + th);
        }
    }

    /* sirveComoModelo es lo que decide si se dice «listo». */
    private static void SirveComoModelo(String z) {
        try {
            java.io.File vacio = tmp("vacio");
            check(!ZipInstall.sirveComoModelo(vacio.getAbsolutePath()),
                "una carpeta vacía NO puede decir que sirve");

            java.io.File soloAm = tmp("am");
            new java.io.File(soloAm, "am").mkdirs();
            new java.io.FileOutputStream(new java.io.File(new java.io.File(soloAm, "am"), "final.mdl")).close();
            check(ZipInstall.sirveComoModelo(soloAm.getAbsolutePath()),
                "con am/final.mdl tiene que decir que sirve");
        } catch (Throwable th) {
            check(false, "excepción en SirveComoModelo: " + th);
        }
    }

    /* Un zip que no existe no puede decir que salió bien. */
    private static void ReportaErrores(String z) {
        ZipInstall.Result r = ZipInstall.extract("/no/existe/el.zip", "/tmp/kiu-no-debe-importar", null);
        check(!r.ok, "un zip inexistente tiene que devolver ok=false");
        check(!r.err.isEmpty(), "y decir por qué");
    }
}
