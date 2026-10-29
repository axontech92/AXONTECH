// kiullama_jni.cpp — wrapper JNI del motor llama.cpp para KIU
// Implementa exactamente el contrato de com.kiu.agent.KiuNative:
//   loadModel(path, nCtx, nThreads) -> boolean   (bloqueante; se llama en worker thread)
//   loadProgress()                  -> {"pct":..,"loading":..,"ready":..,"threads":..}
//   generate(prompt, maxTok, temp)  -> texto final o null (bloqueante; JS sondea genStatus)
//   genStatus()                     -> {"text":..,"done":..,"toks":..,"tps":..}
//   stopGen(), freeModel(), isLoaded(), lastError(), tokensPerSec()
//
// API nativa: llama.cpp vendored en vendor/llama.cpp (commit b476d9a),
// patrón de examples/simple.cpp (llama_batch_ext + llama_process).

#include <jni.h>
#include <algorithm>
#include <string>
#include <vector>
#include <mutex>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <cstdio>
#include "llama.h"

namespace {

// Compatibilidad de firma de llama_sampler_init_penalties (cambia entre versiones de llama.cpp).
// Si la llamada de 4 argumentos compila, se usa; si no, devuelve nullptr y se omite el sampler.
template <typename... A>
auto kiu_penalties_impl(int, A... a) -> decltype(llama_sampler_init_penalties(a...)) {
    return llama_sampler_init_penalties(a...);
}
template <typename... A>
llama_sampler* kiu_penalties_impl(long, A...) { return nullptr; }
template <typename... A>
llama_sampler* kiu_penalties(A... a) { return kiu_penalties_impl(0, a...); }

// v2.9.2: shim de la firma de llama_sampler_init_grammar, con el mismo criterio que
// el de las penalidades: si el vendor no la tiene, devuelve nullptr y el sampler se
// omite — la generacion sigue funcionando SIN gramatica (el parse + reintento del
// bucle es la ruta que hace falta tener igual). Que el build se rompa porque
// upstream renombró algo NO puede ser el precio de una mejora opcional.
//
// Firma conocida (estable desde b1xxx): (const llama_vocab*, const char* grammar_str,
// const char* grammar_root). Si upstream le agrega un parámetro, el 0 de abajo ya no
// compila contra la versión nueva y cae al overload de respaldo.
template <typename... A>
auto kiu_grammar_impl(int, A... a) -> decltype(llama_sampler_init_grammar(a...)) {
    return llama_sampler_init_grammar(a...);
}
template <typename... A>
llama_sampler* kiu_grammar_impl(long, A...) { return nullptr; }
template <typename... A>
llama_sampler* kiu_grammar(A... a) { return kiu_grammar_impl(0, a...); }

std::mutex g_mtx;                 // protege model/ctx y la generación completa
llama_model*    g_model = nullptr;
llama_context*  g_ctx   = nullptr;

std::atomic<bool> g_stop{false};
// llama.cpp puede consultar esto durante decode en CPU, no solo entre lotes.
bool kiu_abort_llama(void*) { return g_stop.load(); }
std::atomic<bool> g_loading{false};
std::atomic<int>  g_load_pct{0};
std::atomic<int>  g_threads{4};
std::atomic<int>  g_ctx_used{0};   // v2.7.4: contexto realmente aplicado (puede ser menor al pedido)
std::atomic<int>  g_toks{0};
std::atomic<double> g_tps{0.0};

// v2.13.7: metadatos del prefijo KV reutilizable. Solo se conservan tokens del
// prompt anterior; los tokens de respuesta se eliminan desde el primer token
// distinto antes de evaluar el siguiente prompt. Se invalida en operaciones que
// limpian o desplazan la memoria para no reutilizar posiciones que ya no existen.
std::vector<llama_token> g_cached_prompt_tokens;
bool g_prompt_cache_valid = false; // protegido por g_mtx

std::mutex g_out_mtx;             // protege g_out y g_err
std::string g_out;                // texto acumulado de la generación actual
std::string g_err;
std::string g_chat_tpl;           // v2.13.3: plantilla de chat del GGUF cargado (protegida por g_out_mtx)

bool g_backend_ready = false;

std::atomic<bool> g_running{false};   // hay una generación en curso (para "done" real)
std::atomic<unsigned long long> g_gen_id{0}; // identifica cada llamada, incluso si termina con cero tokens

// v2.9.2: gramatica de muestreo pendiente (GBNF). La aplica la PROXIMA generate()
// y se consume: si no se consumiera, toda generación posterior de la app —una
// respuesta normal de chat, un resumen— quedaría atada a la gramática de la última
// decisión del agente, que es la peor forma de forgetting: un bug que aparece
// mucho después y parece de otro lado.
std::mutex g_gram_mtx;
std::string g_grammar_pending;
std::atomic<bool> g_grammar_ok{true};

// v2.7.3: NewStringUTF exige "modified UTF-8": los tokens pueden cortar un caracter a la mitad
// (ñ, tildes, emojis de 4 bytes) y los emojis no son validos en modified UTF-8 -> con CheckJNI
// la app abortaba y sin el, el texto salia corrupto. Se recorta la cola incompleta y se
// construye el String por bytes con decodificador UTF-8 real.
size_t utf8_valid_prefix(const std::string& s) {
    size_t n = s.size();
    for (size_t back = 1; back <= 4 && back <= n; back++) {
        unsigned char c = (unsigned char)s[n - back];
        if ((c & 0xC0) == 0x80) continue;                      // byte de continuacion
        size_t need = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 1;
        return (need > back) ? n - back : n;                   // secuencia incompleta: cortarla
    }
    return n;
}

jstring mk_jstring(JNIEnv* env, const std::string& s) {
    size_t len = utf8_valid_prefix(s);
    jbyteArray arr = env->NewByteArray((jsize)len);
    if (arr == nullptr) { if (env->ExceptionCheck()) env->ExceptionClear(); return nullptr; }
    if (len > 0) env->SetByteArrayRegion(arr, 0, (jsize)len, (const jbyte*)s.data());
    jstring res = nullptr;
    jclass sc = env->FindClass("java/lang/String");
    jstring cs = env->NewStringUTF("UTF-8");
    if (sc != nullptr && cs != nullptr) {
        jmethodID ctor = env->GetMethodID(sc, "<init>", "([BLjava/lang/String;)V");
        if (ctor != nullptr) res = (jstring)env->NewObject(sc, ctor, arr, cs);
    }
    if (env->ExceptionCheck()) { env->ExceptionClear(); res = nullptr; }
    if (cs != nullptr) env->DeleteLocalRef(cs);
    if (sc != nullptr) env->DeleteLocalRef(sc);
    env->DeleteLocalRef(arr);
    return res;
}

struct RunGuard {   // marca g_running mientras vive generate(), en TODOS sus caminos de salida
    RunGuard() { g_running = true; }
    ~RunGuard() { g_running = false; }
};

// v2.3.0 · sección 2: push de tokens en vivo hacia Java (KiuStream.onToken).
// Se avisa cada 300 ms o cada 16 tokens (lo que ocurra primero) para que la UI
// pinte la respuesta mientras nace y el JS no dependa del sondeo de 130 ms.
// En .so precompiladas viejas no hay clase que reciba nada distinto: si
// FindClass falla, se apaga el push y todo sigue por el camino de siempre.
void stream_push(JNIEnv* env, const std::string& soFar, long long& lastUs, int& lastTok) {
    if (env == nullptr || soFar.empty()) return;
    long long now = ggml_time_us();
    if (now - lastUs < 300000 && lastTok + 16 > g_toks.load()) return;
    lastUs = now;
    lastTok = g_toks.load();
    jclass cls = env->FindClass("com/kiu/agent/KiuStream");
    if (cls == nullptr) { if (env->ExceptionCheck()) env->ExceptionClear(); return; }
    jmethodID mid = env->GetStaticMethodID(cls, "onToken", "(Ljava/lang/String;)V");
    if (mid == nullptr) { if (env->ExceptionCheck()) env->ExceptionClear(); env->DeleteLocalRef(cls); return; }
    jstring js = mk_jstring(env, soFar);
    if (js != nullptr) env->CallStaticVoidMethod(cls, mid, js);
    if (env->ExceptionCheck()) env->ExceptionClear();
    env->DeleteLocalRef(js);
    env->DeleteLocalRef(cls);
}

std::string j2s(JNIEnv* env, jstring s) {
    if (s == nullptr) return "";
    const char* p = env->GetStringUTFChars(s, nullptr);
    std::string out = p ? p : "";
    if (p) env->ReleaseStringUTFChars(s, p);
    return out;
}

std::string json_escape(const std::string& in) {
    std::string o;
    o.reserve(in.size() + 16);
    for (unsigned char c : in) {
        switch (c) {
            case '"':  o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n";  break;
            case '\r': o += "\\r";  break;
            case '\t': o += "\\t";  break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    o += buf;
                } else {
                    o += (char)c;
                }
        }
    }
    return o;
}

// v2.7.4: RAM disponible (MemAvailable) y estimacion del KV cache. Un contexto de 32k en un modelo
// grande pide GB de KV: Android mata el proceso (lowmemorykiller) sin dejar ningun error. Los pesos
// van por mmap (paginas recuperables), asi que el presupuesto se compara solo con KV + buffers.
long long mem_available_bytes() {
    FILE* f = fopen("/proc/meminfo", "r");
    if (!f) return 0;
    char line[256];
    long long kb = 0;
    while (fgets(line, sizeof(line), f)) {
        if (sscanf(line, "MemAvailable: %lld kB", &kb) == 1) break;
        kb = 0;
    }
    fclose(f);
    return kb * 1024LL;
}

long long kv_bytes_estimate(const llama_model* m, int ctx, bool q8_cache = true) {
    long long n_layer = llama_model_n_layer(m);
    long long n_embd  = llama_model_n_embd(m);
    long long n_head  = llama_model_n_head(m);
    long long n_kv    = llama_model_n_head_kv(m);
    if (n_layer <= 0 || n_embd <= 0 || n_head <= 0) return 0;
    if (n_kv <= 0) n_kv = n_head;
    long long kv_dim = n_embd / n_head * n_kv;
    // Q8_0 usa ~1.0625 bytes/valor (bloques de 32); reservamos 1.125
    // para metadatos/alineación. FP16 usa 2 bytes/valor.
    const long long bytes_per_value_x8 = q8_cache ? 9 : 16;
    return 2LL * n_layer * (long long)ctx * kv_dim * bytes_per_value_x8 / 8LL;
}

void set_err(const std::string& e) {
    std::lock_guard<std::mutex> lk(g_out_mtx);
    g_err = e;
}

void free_locked() {
    // llama g_mtx al llamar
    g_cached_prompt_tokens.clear();
    g_prompt_cache_valid = false;
    if (g_ctx)   { llama_free(g_ctx);            g_ctx = nullptr; }
    if (g_model) { llama_model_free(g_model);    g_model = nullptr; }
    { std::lock_guard<std::mutex> tl(g_out_mtx); g_chat_tpl.clear(); }
}

void log_silencer(ggml_log_level, const char*, void*) {
    // silencio: evita inundar logcat durante la generación
}

} // namespace

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_kiu_agent_KiuNative_loadModel(JNIEnv* env, jclass, jstring path, jint n_ctx, jint n_threads) {
    std::string p = j2s(env, path);
    int ctx = n_ctx < 512 ? 2048 : n_ctx;
    if (ctx > 32768) ctx = 32768;
    int th = n_threads < 1 ? 4 : n_threads;
    g_threads = th;
    g_stop = false;

    std::lock_guard<std::mutex> lk(g_mtx);
    free_locked();

    if (!g_backend_ready) {
        llama_log_set(log_silencer, nullptr);
        llama_backend_init();
        g_backend_ready = true;
    }

    g_loading = true;
    g_load_pct = 5;

    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;   // CPU puro (igual que el prebuilt original); mmap va por defecto

    g_load_pct = 20;
    g_model = llama_model_load_from_file(p.c_str(), mp);
    if (!g_model) {
        set_err("no pude cargar el modelo (archivo danado o sin RAM suficiente)");
        g_loading = false;
        g_load_pct = 0;
        return JNI_FALSE;
    }

    {   // v2.13.3: guardar la plantilla del GGUF (puede no tener: nullptr). Se lee acá, con
        // g_mtx tomado, y se sirve desde una copia: el getter no puede esperar una generación.
        const char* tpl = llama_model_chat_template(g_model, nullptr);
        std::lock_guard<std::mutex> tl(g_out_mtx);
        g_chat_tpl = tpl ? std::string(tpl, strnlen(tpl, 32768)) : std::string();
    }

    g_load_pct = 70;
    {   // v2.7.4: bajar el contexto si el KV cache no entra en la RAM libre (en vez de morir por OOM)
        long long avail = mem_available_bytes();
        if (avail > 0) {
            while (ctx > 512 && kv_bytes_estimate(g_model, ctx, true) / 100 * 125 > avail / 100 * 70) ctx /= 2;
        }
        g_ctx_used = ctx;
    }
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = (uint32_t)ctx;
    cp.n_batch = 512;
    cp.n_ubatch = 256;
    cp.n_threads = th;
    cp.n_threads_batch = th;
    cp.no_perf = false;
    // El modelo se carga en CPU (n_gpu_layers=0); el callback permite que
    // stopGen interrumpa una evaluación larga en vez de esperar al lote completo.
    cp.abort_callback = kiu_abort_llama;
    cp.abort_callback_data = nullptr;
    // v2.11.20: conservar salidas de embeddings para extraer vectores del
    // modelo local ya cargado, sin cargar un segundo modelo en RAM.
    cp.embeddings = true;
    // v2.11: cache KV cuantizada Q8_0 reduce aproximadamente a la mitad la
    // memoria del contexto. Si esta combinación de backend/modelo no se admite,
    // reintentamos con FP16 para conservar compatibilidad.
    cp.type_k = GGML_TYPE_Q8_0;
    cp.type_v = GGML_TYPE_Q8_0;
    g_ctx = llama_init_from_model(g_model, cp);
    if (!g_ctx) {
        cp.type_k = GGML_TYPE_F16;
        cp.type_v = GGML_TYPE_F16;
        // FP16 necesita más RAM. Si el contexto original no entra, reducirlo
        // gradualmente en lugar de fallar inmediatamente.
        while (!g_ctx && ctx > 512) {
            ctx /= 2;
            cp.n_ctx = (uint32_t)ctx;
            g_ctx_used = ctx;
            g_ctx = llama_init_from_model(g_model, cp);
        }
    }
    if (!g_ctx) {
        set_err("no pude crear el contexto de inferencia (poca RAM o cache KV no compatible)");
        g_loading = false;
        g_load_pct = 0;
        free_locked();
        return JNI_FALSE;
    }

    g_loading = false;
    g_load_pct = 100;
    set_err("");
    return JNI_TRUE;
}

JNIEXPORT jfloatArray JNICALL
Java_com_kiu_agent_KiuNative_embedText(JNIEnv* env, jclass, jstring text) {
    std::string input = j2s(env, text);
    if (input.empty()) return nullptr;
    std::lock_guard<std::mutex> lk(g_mtx);
    if (g_model == nullptr || g_ctx == nullptr || g_running.load()) return nullptr;

    const llama_vocab* vocab = llama_model_get_vocab(g_model);
    int32_t n_tokens = -llama_tokenize(vocab, input.c_str(), (int32_t)input.size(), nullptr, 0, true, true);
    if (n_tokens <= 0) return nullptr;
    std::vector<llama_token> tokens((size_t)n_tokens);
    int32_t got = llama_tokenize(vocab, input.c_str(), (int32_t)input.size(), tokens.data(), n_tokens, true, true);
    if (got <= 0) return nullptr;
    n_tokens = got;
    // Limitar coste por documento/consulta en móviles: solo los primeros 96 tokens.
    if (n_tokens > 96) { n_tokens = 96; tokens.resize(96); }

    llama_batch_ext* batch = llama_batch_ext_init(g_ctx);
    if (!batch) return nullptr;
    llama_batch_ext_clear(batch);
    for (int32_t i = 0; i < n_tokens; ++i) {
        int32_t idx = llama_batch_ext_add_token(batch, 0, tokens[(size_t)i]);
        llama_pos pos = i;
        llama_batch_ext_set_pos(batch, idx, &pos);
        llama_batch_ext_set_output_logits(batch, idx, true);
    }
    // El contexto es compartido con generación: limpiamos antes y después para
    // que la consulta de embeddings no contamine el historial de generación.
    // Los embeddings comparten el contexto con generación: limpiar aquí invalida
    // cualquier prefijo KV que se hubiese conservado para el chat.
    g_cached_prompt_tokens.clear();
    g_prompt_cache_valid = false;
    llama_memory_clear(llama_get_memory(g_ctx), true);
    int rc = llama_process(g_ctx, LLAMA_PROCESS_TYPE_DECODE, batch);
    int n_embd = llama_model_n_embd(g_model);
    std::vector<float> pooled((size_t)n_embd, 0.0f);
    bool valid = rc == 0 && n_embd > 0;
    if (valid) {
        int used = 0;
        for (int32_t i = 0; i < n_tokens; ++i) {
            const float* emb = llama_get_embeddings_ith(g_ctx, i);
            if (!emb) continue;
            for (int j = 0; j < n_embd; ++j) pooled[(size_t)j] += emb[j];
            ++used;
        }
        valid = used > 0;
        if (valid) {
            double norm = 0.0;
            for (int j = 0; j < n_embd; ++j) { pooled[(size_t)j] /= (float)used; norm += (double)pooled[(size_t)j] * pooled[(size_t)j]; }
            norm = std::sqrt(norm);
            if (norm > 1e-12) for (int j = 0; j < n_embd; ++j) pooled[(size_t)j] /= (float)norm;
            else valid = false;
        }
    }
    llama_memory_clear(llama_get_memory(g_ctx), true);
    g_cached_prompt_tokens.clear();
    g_prompt_cache_valid = false;
    llama_batch_ext_free(batch);
    if (!valid) return nullptr;
    jfloatArray result = env->NewFloatArray(n_embd);
    if (result) env->SetFloatArrayRegion(result, 0, n_embd, pooled.data());
    return result;
}

JNIEXPORT jstring JNICALL
Java_com_kiu_agent_KiuNative_loadProgress(JNIEnv* env, jclass) {
    bool ready = (!g_loading && g_model != nullptr && g_ctx != nullptr);
    char buf[200];
    snprintf(buf, sizeof(buf), "{\"pct\":%d,\"loading\":%s,\"ready\":%s,\"threads\":%d,\"ctx\":%d}",
             g_load_pct.load(), g_loading.load() ? "true" : "false",
             ready ? "true" : "false", g_threads.load(), g_ctx_used.load());
    return env->NewStringUTF(buf);
}

JNIEXPORT jboolean JNICALL
Java_com_kiu_agent_KiuNative_isLoaded(JNIEnv*, jclass) {
    return (!g_loading && g_model != nullptr && g_ctx != nullptr) ? JNI_TRUE : JNI_FALSE;
}

// v2.13.3: plantilla de chat del GGUF cargado ("" si no hay modelo o no trae plantilla).
// El JS la usa para ELEGIR el formato (ChatML / Llama 3 / Gemma / Mistral) por lo que dice
// el propio modelo, no por el nombre del archivo.
JNIEXPORT jstring JNICALL
Java_com_kiu_agent_KiuNative_chatTemplate(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lk(g_out_mtx);
    return mk_jstring(env, g_chat_tpl);
}

JNIEXPORT jstring JNICALL
Java_com_kiu_agent_KiuNative_lastError(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lk(g_out_mtx);
    return mk_jstring(env, g_err);
}

JNIEXPORT void JNICALL
Java_com_kiu_agent_KiuNative_stopGen(JNIEnv*, jclass) {
    g_stop = true;
    // v2.9.2: si se cancela una decisión, su gramatica no debe quedar esperando
    // la proxima generacion (que podria ser un chat normal, de otra cosa).
    {
        std::lock_guard<std::mutex> lk(g_gram_mtx);
        g_grammar_pending.clear();
    }
}

JNIEXPORT jfloat JNICALL
Java_com_kiu_agent_KiuNative_tokensPerSec(JNIEnv*, jclass) {
    return (jfloat)g_tps.load();
}

JNIEXPORT void JNICALL
Java_com_kiu_agent_KiuNative_freeModel(JNIEnv*, jclass) {
    g_stop = true;
    std::lock_guard<std::mutex> lk(g_mtx);
    free_locked();
    /* tanda 8 (KNOWN_ISSUES): liberar también el backend global de llama.cpp.
     * loadModel() lo re-inicializa solo (g_backend_ready en false → init de
     * nuevo), así que recargar un modelo después de free sigue funcionando. */
    if (g_backend_ready) {
        llama_backend_free();
        g_backend_ready = false;
    }
    g_load_pct = 0;
    std::lock_guard<std::mutex> lk2(g_out_mtx);
    g_out.clear();
}

JNIEXPORT jstring JNICALL
Java_com_kiu_agent_KiuNative_genStatus(JNIEnv* env, jclass) {
    std::string text;
    {
        std::lock_guard<std::mutex> lk(g_out_mtx);
        text = g_out;
    }
    text.resize(utf8_valid_prefix(text));   // no mostrar un caracter a medio llegar
    std::string esc = json_escape(text);
    char buf[160];
    // done describe el estado real del worker, no si ya emitió tokens. Esto permite
    // detectar terminaciones tempranas y errores antes del primer token.
    bool running = g_running.load();
    // done también debe ser true cuando el modelo termina con cero tokens; de
    // otro modo el watchdog JS espera 180 s porque su ruta de 6 s nunca se activa.
    bool done = !running;
    snprintf(buf, sizeof(buf), ",\"toks\":%d,\"tps\":%.1f,\"running\":%s,\"id\":%llu,\"done\":%s}",
             g_toks.load(), g_tps.load(), running ? "true" : "false", g_gen_id.load(), done ? "true" : "false");
    std::string s = "{\"text\":\"" + esc + "\"" + buf;
    return mk_jstring(env, s);
}

// v2.9.2 — gramatica de muestreo para la PROXIMA generación.
//
// Se separa de generate() a propósito: cambiar la firma de un método nativo
// rompe el puente JS entero (kiuGen es el que llama motor.js) y obliga a tocar
// dos lados. Con un setter aparte, el JS pone la gramatica justo antes de pedir
// la decisión y el resto de la app sigue usando generate(prompt, max, temp) sin
// enterarse de que existe.
//
// Vaciar con "" desactiva. Consumir en la generate() siguiente es obligatorio:
// una gramatica pegada para siempre deixa atada toda generación posterior.
JNIEXPORT void JNICALL
Java_com_kiu_agent_KiuNative_setGrammar(JNIEnv* env, jclass, jstring gbnf) {
    std::string g = (gbnf == nullptr) ? std::string() : j2s(env, gbnf);
    std::lock_guard<std::mutex> lk(g_gram_mtx);
    g_grammar_pending = g;
}

// v2.9.2: ¿la ultima gramatica se pudo aplicar? El JS lo consulta para saber si
// está suponiendo una gramática que en realidad no restringió nada — que es
// peor que no tenerla, porque el bucle cree que el JSON va a salir bien.
JNIEXPORT jboolean JNICALL
Java_com_kiu_agent_KiuNative_grammarOk(JNIEnv*, jclass) {
    return g_grammar_ok.load() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jstring JNICALL
Java_com_kiu_agent_KiuNative_grammarPending(JNIEnv* env, jclass) {
    std::string g;
    {
        std::lock_guard<std::mutex> lk(g_gram_mtx);
        g = g_grammar_pending;
    }
    return mk_jstring(env, g);
}

JNIEXPORT jstring JNICALL
Java_com_kiu_agent_KiuNative_generate(JNIEnv* env, jclass, jstring prompt, jint max_tokens, jfloat temp) {
    // Publicar el inicio ANTES de esperar el mutex. Así el JS distingue esta
    // solicitud de los datos "done/text" que quedaron de la generación anterior.
    RunGuard runGuard;
    g_gen_id.fetch_add(1);
    g_stop = false;
    g_toks = 0;
    g_tps = 0.0;
    {
        std::lock_guard<std::mutex> lk2(g_out_mtx);
        g_out.clear();
        g_err.clear();
    }

    std::string pr = j2s(env, prompt);
    int n_predict = max_tokens < 1 ? 256 : max_tokens;
    float temperature = temp;

    std::lock_guard<std::mutex> lk(g_mtx);
    if (g_model == nullptr || g_ctx == nullptr) {
        set_err("modelo no cargado");
        return nullptr;
    }

    const llama_vocab* vocab = llama_model_get_vocab(g_model);

    int n_prompt = -llama_tokenize(vocab, pr.c_str(), (int32_t)pr.size(), NULL, 0, true, true);
    if (n_prompt <= 0) {
        set_err("prompt vacio");
        return nullptr;
    }
    std::vector<llama_token> toks(n_prompt);
    if (llama_tokenize(vocab, pr.c_str(), (int32_t)pr.size(), toks.data(), (int32_t)toks.size(), true, true) < 0) {
        set_err("fallo al tokenizar el prompt");
        return nullptr;
    }

    const int n_ctx = (int)llama_n_ctx(g_ctx);
    // si el prompt no entra, recortamos del medio (mantenemos inicio y fin)
    const int headroom = 64;
    // v2.7.3: con n_predict grande (p.ej. 4096 y ctx 2048) "usable" quedaba en 16 tokens y el
    // prompt se destrozaba. El context shift ya permite pasar de la ventana: se reserva como
    // maximo 1/4 del contexto para la respuesta.
    const int reserve = n_predict < n_ctx / 4 ? n_predict : n_ctx / 4;
    if (n_prompt > n_ctx - headroom - reserve) {
        int usable = n_ctx - headroom - reserve;
        if (usable < 16) usable = 16;
        int keep_tail = usable / 4;
        int keep_head = usable - keep_tail;
        std::vector<llama_token> trimmed;
        trimmed.reserve(usable);
        for (int i = 0; i < keep_head && i < n_prompt; i++) trimmed.push_back(toks[i]);
        for (int i = n_prompt - keep_tail; i < n_prompt; i++) if (i >= 0) trimmed.push_back(toks[i]);
        toks.swap(trimmed);
        n_prompt = (int)toks.size();
    }

    // v2.13.7: reutilización conservadora del prefijo común. La caché solo es
    // válida si la generación anterior no desplazó contexto y ninguna operación
    // (p. ej. embeddings) limpió la memoria. Siempre reevaluamos al menos el
    // último token del prompt para restaurar logits correctos para el sampler.
    int reuse_tokens = 0;
    llama_memory_t prompt_mem = llama_get_memory(g_ctx);
    if (g_prompt_cache_valid && !g_cached_prompt_tokens.empty() && n_prompt > 1) {
        const int max_common = (int)std::min(g_cached_prompt_tokens.size(), toks.size());
        while (reuse_tokens < max_common && g_cached_prompt_tokens[(size_t)reuse_tokens] == toks[(size_t)reuse_tokens]) {
            ++reuse_tokens;
        }
        if (reuse_tokens >= n_prompt) reuse_tokens = n_prompt - 1;
        if (reuse_tokens > 0) {
            // Borra la respuesta anterior y el sufijo antiguo; el prefijo [0,reuse)
            // permanece en KV. End=-1 significa hasta el final de la secuencia.
            llama_memory_seq_rm(prompt_mem, 0, reuse_tokens, -1);
        }
    }
    if (reuse_tokens == 0) {
        llama_memory_clear(prompt_mem, true);
        g_prompt_cache_valid = false;
        g_cached_prompt_tokens.clear();
    }

    // sampler: greedy si temp<=0, si no min_p + temp + dist
    auto sp = llama_sampler_chain_default_params();
    sp.no_perf = false;
    llama_sampler* smpl = llama_sampler_chain_init(sp);
    if (smpl == nullptr) {
        set_err("no pude reservar el sampler del motor");
        return nullptr;
    }
    // v2.7.4: penalizacion de repeticion (ultimos 64 tokens, x1.1): los modelos chicos entraban en
    // bucles ("y y y y"). Firma de 4 argumentos (llama.cpp >= b3900); si el vendor es mas viejo, ajustar.
    // Se llama a traves de kiu_penalties(): si el llama.cpp vendorizado cambia la firma, el build NO se rompe
    // (compila igual y solo se omite la penalizacion). Firma conocida: (last_n, repeat, freq, present).
    if (llama_sampler* pen = kiu_penalties(64, 1.10f, 0.0f, 0.0f)) llama_sampler_chain_add(smpl, pen);
    if (temperature <= 0.0f) {
        llama_sampler_chain_add(smpl, llama_sampler_init_greedy());
    } else {
        llama_sampler_chain_add(smpl, llama_sampler_init_min_p(0.05f, 1));
        llama_sampler_chain_add(smpl, llama_sampler_init_temp(temperature));
        llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
    }

    // v2.9.2: la gramatica va SIEMPRE al final de la cadena. Es lo que decide si
    // el motor descarta un token: lo que no encaje con la gramatica no se puede
    // emitir. Si fuera antes, los samplers de arriba verian tokens que despues
    // se rechazan y el resultado seria incoherente.
    //
    // OJO: si viniera temp > 0 habria un sampler de_dist ALEATORIO antes. El
    // de abajo (la gramatica) va ultimo y es el que decide, asi que el resultado
    // igual quedaria restringido: la gramatica acota el conjunto, la temperatura
    // elige dentro. Aun asi, motor.js manda temp=0 cuando manda gramatica, para
    // no depender de cual de los dos gana el conflicto.
    std::string gbnf;
    {
        std::lock_guard<std::mutex> glk(g_gram_mtx);
        gbnf.swap(g_grammar_pending);   // consumir: una gramatica es de UNA generación
    }
    g_grammar_ok = true;
    if (!gbnf.empty()) {
        const llama_vocab* gv = llama_model_get_vocab(g_model);
        if (gv == nullptr) {
            set_err("no pude obtener el vocabulario para la gramatica");
        } else {
            llama_sampler* gs = kiu_grammar(gv, gbnf.c_str(), "root");
            if (gs != nullptr) {
                llama_sampler_chain_add(smpl, gs);
            } else {
                // No se pudo crear el sampler. OJO: esto NO es un error de
                // generacion — la generacion sigue y sale texto normal, sin
                // restringir. Por eso no va por set_err() (que se lee cuando la
                // generacion falla y envenenaría el próximo error real). Va por
                // su propio canal para que el JS lo sepa por kiuGrammarOk().
                std::lock_guard<std::mutex> glk2(g_gram_mtx);
                g_grammar_ok = false;
            }
        }
    }

    llama_batch_ext* batch = llama_batch_ext_init(g_ctx);
    if (batch == nullptr) {
        llama_sampler_free(smpl);
        set_err("no pude reservar el batch de inferencia (memoria insuficiente)");
        return nullptr;
    }
    llama_token* one = (llama_token*)malloc(sizeof(llama_token));
    if (one == nullptr) {
        llama_batch_ext_free(batch);
        llama_sampler_free(smpl);
        set_err("no pude reservar memoria para el siguiente token");
        return nullptr;
    }

    const auto t0 = ggml_time_us();
    std::string out;
    int n_pos = 0;
    bool ok = true;
    long long lastPushUs = 0;
    int lastPushTok = -1;
    // el primer push arranca recién con algo de texto para no despertar la UI en vano
    lastPushUs = t0 - 300000;

    auto emit = [&](llama_token* data, int32_t count, int32_t pos0, bool logits_last) {
        llama_batch_ext_clear(batch);
        for (int32_t i = 0; i < count; i++) {
            int32_t idx = llama_batch_ext_add_token(batch, 0, data[i]);
            llama_pos pos = pos0 + i;
            llama_batch_ext_set_pos(batch, idx, &pos);
        }
        if (logits_last) {
            llama_batch_ext_set_output_logits(batch, count - 1, true);
        }
    };

    // prefill del prompt por lotes
    const int n_batch = 512;
    int done = reuse_tokens;
    n_pos = reuse_tokens;
    bool context_shifted = false;
    while (done < n_prompt) {
        if (g_stop) { ok = false; break; }
        int chunk = n_prompt - done;
        if (chunk > n_batch) chunk = n_batch;
        bool last = (done + chunk >= n_prompt);
        emit(toks.data() + done, chunk, n_pos, last);
        if (llama_process(g_ctx, LLAMA_PROCESS_TYPE_DECODE, batch)) {
            set_err("fallo de evaluacion (prefill)");
            ok = false;
            break;
        }
        n_pos += chunk;
        done += chunk;
    }

    if (ok) {
        for (int i = 0; i < n_predict; i++) {
            if (g_stop) break;

            // context shift si nos quedamos sin ventana
            if (n_pos + 2 >= n_ctx) {
                llama_memory_t mem = llama_get_memory(g_ctx);
                if (llama_memory_can_shift(mem)) {
                    int n_keep = n_pos / 4 < 16 ? 16 : (n_pos / 4 > 256 ? 256 : n_pos / 4); // v2.7.3: conserva el inicio (system prompt)
                    int n_left = n_pos - n_keep;
                    if (n_left > 8) {
                        int n_discard = n_left / 2;
                        llama_memory_seq_rm(mem, 0, n_keep, n_keep + n_discard);
                        llama_memory_seq_add(mem, 0, n_keep + n_discard, -1, -n_discard);
                        n_pos -= n_discard;
                        context_shifted = true;
                        g_prompt_cache_valid = false;
                        g_cached_prompt_tokens.clear();
                    }
                } else {
                    set_err("contexto lleno");
                    ok = false;
                    break;
                }
            }

            llama_token id = llama_sampler_sample(smpl, g_ctx, -1);
            if (llama_vocab_is_eog(vocab, id)) break;

            char piece[192];
            int n = llama_token_to_piece(vocab, id, piece, sizeof(piece), 0, true);
            std::string bigPiece;   // v2.7.3: si la pieza no cabe (n<0) antes se perdia en silencio
            const char* pdata = piece;
            if (n < 0) {
                bigPiece.resize((size_t)(-n));
                n = llama_token_to_piece(vocab, id, &bigPiece[0], (int32_t)bigPiece.size(), 0, true);
                pdata = bigPiece.data();
            }
            if (n > 0) {
                out.append(pdata, n);
                {
                    std::lock_guard<std::mutex> lk2(g_out_mtx);
                    g_out = out;
                }
                stream_push(env, out, lastPushUs, lastPushTok); // v2.3.0: streaming por push
            }
            g_toks = i + 1;
            const auto now = ggml_time_us();
            double secs = (double)(now - t0) / 1000000.0;
            if (secs > 0.05) g_tps = (double)(i + 1) / secs;

            one[0] = id;
            emit(one, 1, n_pos, true);
            if (llama_process(g_ctx, LLAMA_PROCESS_TYPE_DECODE, batch)) {
                set_err("fallo de evaluacion");
                ok = false;
                break;
            }
            n_pos += 1;
        }
    }
    free(one);

    llama_batch_ext_free(batch);
    llama_sampler_free(smpl);

    // Guardar solo si el prompt entero fue prellenado y no hubo context shift.
    // Aunque la respuesta esté incompleta por cancelación, el siguiente turno
    // eliminará todo lo que esté después del prefijo común antes de reutilizarlo.
    if (ok && !context_shifted && done == n_prompt) {
        g_cached_prompt_tokens = toks;
        g_prompt_cache_valid = true;
    } else {
        g_cached_prompt_tokens.clear();
        g_prompt_cache_valid = false;
    }

    if (!ok && out.empty()) {
        return nullptr;
    }
    return mk_jstring(env, out);
}

} // extern "C"
