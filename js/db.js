// ══════════════════════════════════════════
//  js/db.js - IndexedDB Data Layer (AXONTECH)
//  Reemplaza localStorage con IndexedDB
// ══════════════════════════════════════════

const DB_NAME = 'axon_tech';
const DB_VERSION = 1;

let db = null;

// Definición de stores
const STORES = [
  'gestores',
  'vales',
  'mensajeros',
  'productos',
  'categorias',
  'config',
  'notifs'
];

// Inicializar IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      
      STORES.forEach(storeName => {
        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, { 
            keyPath: 'id',
            autoIncrement: false 
          });
          
          // Índices útiles
          if (storeName === 'vales') {
            store.createIndex('gestorId', 'gestorId', { unique: false });
            store.createIndex('status', 'status', { unique: false });
          }
          if (storeName === 'productos') {
            store.createIndex('categoria', 'categoria', { unique: false });
          }
        }
      });
    };
  });
}

// Helper genérico para obtener todos los registros de un store
async function getAll(storeName) {
  await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// Helper genérico para guardar un array completo
async function saveAll(storeName, items) {
  await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    
    // Limpiar store primero
    const clearRequest = store.clear();
    
    clearRequest.onsuccess = () => {
      if (!items || items.length === 0) {
        resolve();
        return;
      }
      
      let completed = 0;
      items.forEach(item => {
        const request = store.put(item);
        request.onsuccess = () => {
          completed++;
          if (completed === items.length) resolve();
        };
        request.onerror = () => reject(request.error);
      });
    };
    
    clearRequest.onerror = () => reject(clearRequest.error);
  });
}

// Obtener un solo registro por ID
async function getById(storeName, id) {
  await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(id);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Guardar un solo registro
async function put(storeName, item) {
  await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(item);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Eliminar un registro
async function remove(storeName, id) {
  await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ══════════════════════════════════════════
//  API COMPATIBLE CON EL CÓDIGO ANTIGUO
// ══════════════════════════════════════════

const getGestores   = () => getAll('gestores');
const saveGestores  = v => saveAll('gestores', v);

const getVales      = () => getAll('vales');
const saveVales     = v => saveAll('vales', v);

const getMensajeros = () => getAll('mensajeros');
const saveMensajeros= v => saveAll('mensajeros', v);

const getProductos  = () => getAll('productos');
const saveProductos = v => saveAll('productos', v);

const getCategorias = () => getAll('categorias');
const saveCategorias= v => saveAll('categorias', v);

const getConfig     = async () => {
  const configs = await getAll('config');
  return configs[0] || {};
};
const saveConfig    = async (v) => {
  await saveAll('config', [v]);
};

const getNotifs     = () => getAll('notifs');
const saveNotifs    = v => saveAll('notifs', v);

// Funciones de parcheo (compatibilidad)
async function patchVale(id, changes) {
  const vale = await getById('vales', id);
  if (vale) {
    Object.assign(vale, changes);
    await put('vales', vale);
  }
}

async function patchProducto(id, changes) {
  const prod = await getById('productos', id);
  if (prod) {
    Object.assign(prod, changes);
    await put('productos', prod);
  }
}

// ══════════════════════════════════════════
//  MIGRACIÓN DESDE localStorage
// ══════════════════════════════════════════

async function migrateFromLocalStorage() {
  const keys = [
    'axon_gestores',
    'axon_vales',
    'axon_mensajeros',
    'axon_productos',
    'axon_categorias',
    'axon_config',
    'axon_notifs'
  ];

  let migrated = false;

  for (const key of keys) {
    const data = localStorage.getItem(key);
    if (data) {
      try {
        const parsed = JSON.parse(data);
        const storeName = key.replace('axon_', '');
        
        if (Array.isArray(parsed)) {
          await saveAll(storeName, parsed);
        } else if (typeof parsed === 'object') {
          await saveAll(storeName, [parsed]);
        }
        
        localStorage.removeItem(key); // Limpiar después de migrar
        migrated = true;
      } catch (e) {
        console.error('Error migrando', key, e);
      }
    }
  }

  if (migrated) {
    console.log('%c[DB] Migración de localStorage completada', 'color:#22c55e');
  }
  
  return migrated;
}

// Inicializar todo al cargar
async function initDataLayer() {
  await initDB();
  await migrateFromLocalStorage();
  console.log('%c[DB] IndexedDB inicializado correctamente', 'color:#3b82f6');
}

// Exportar para uso global
window.initDataLayer = initDataLayer;
window.migrateFromLocalStorage = migrateFromLocalStorage;