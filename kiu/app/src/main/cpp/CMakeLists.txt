# CMakeLists del motor KIU — compila el wrapper JNI contra llama.cpp vendored
#
# Requiere: vendor/llama.cpp presente (ejecutar ./scripts/vendor_llama.sh)
# Gradle activa este build automáticamente cuando vendor/llama.cpp existe.

cmake_minimum_required(VERSION 3.22.1)
project(kiullama LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

get_filename_component(KIU_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../.." ABSOLUTE)
set(LLAMA_DIR "${KIU_ROOT}/vendor/llama.cpp")

if(NOT EXISTS "${LLAMA_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "vendor/llama.cpp no encontrado. Ejecutá ./scripts/vendor_llama.sh")
endif()

# Solo la librería central: sin ejemplos, tests ni herramientas
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER   OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL           OFF CACHE BOOL "" FORCE)

# Inyección nativa: los .so compilados (libkiullama + libllama + libggml*) quedan
# también en app/src/main/jniLibs/<ABI>/ (carpeta fuera de Git). Gradle empaqueta
# las del pipeline CMake directamente; la carpeta sirve para inspección y para
# reutilizarlas como precompiladas en máquinas sin NDK.
# Va ANTES de add_subdirectory para que los subproyectos (llama.cpp/ggml) hereden.
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${KIU_ROOT}/app/src/main/jniLibs/${ANDROID_ABI}")

add_subdirectory("${LLAMA_DIR}" llama.cpp-build)

add_library(kiullama SHARED kiullama_jni.cpp)

find_library(log-lib log)
target_link_libraries(kiullama PRIVATE llama ${log-lib})

# Optimización agresiva para inferencia en CPU móvil
target_compile_options(kiullama PRIVATE -O3 -ffunction-sections -fdata-sections)
target_link_options(kiullama PRIVATE -Wl,--gc-sections)
