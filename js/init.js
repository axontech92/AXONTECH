// ══════════════════════════════════════════
//  js/init.js - Inicialización de la aplicación
// ══════════════════════════════════════════

async function initializeApp() {
  console.log('%c[AXONTECH] Iniciando aplicación...', 'color:#3b82f6');
  
  // 1. Inicializar capa de datos (IndexedDB + migración)
  if (window.initDataLayer) {
    await window.initDataLayer();
  }
  
  // 2. Aquí se inicializará el resto de la app
  // (renderizado inicial, event listeners, etc.)
  
  console.log('%c[AXONTECH] Aplicación lista', 'color:#22c55e');
}

// Auto-inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}