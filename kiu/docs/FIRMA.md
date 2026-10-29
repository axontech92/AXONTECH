# Firma del APK — cómo no perderla

Android solo actualiza una app si el APK nuevo está firmado con la **misma clave** que el instalado.
Si cambia la clave, hay que desinstalar Kiu (y se pierden sus datos).

## Qué guardar (fuera de GitHub)
1. El archivo `kiu-release.jks`.
2. Su contraseña (la misma para el keystore y para la clave) y el alias (`kiu`).

Guardalos en un gestor de contraseñas y en una copia aparte (nube privada o pendrive).
GitHub Secrets **no se puede leer de vuelta**: si perdés el `.jks`, no hay forma de recuperarlo.

## Secretos del repositorio
*Settings → Secrets and variables → Actions → Repository secrets*

- `KIU_KEYSTORE_BASE64`: `base64 -w0 kiu-release.jks` (una sola línea; en Mac `base64 -i`).
- `KIU_KEYSTORE_PASSWORD`: la contraseña.

## Cómo comprobar que la firma no cambió
Cada build muestra en su **Summary** la huella SHA-256 de la firma. Si coincide con la del build
anterior, la actualización se instala encima. El paso «Verificar firma» corta el build con el
motivo exacto si el keystore está vacío, la contraseña no abre o falta el alias.
