// ══════════════════════════════════════════
//  SECURITY FIXES - AXONTECH
//  Aplicar estos cambios en app.js
// ══════════════════════════════════════════

// 1. REEMPLAZAR FUNCIÓN checkPass (líneas ~172-179)
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'axon_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkPass(input) {
  const storedHash = localStorage.getItem('axon_admin_hash');
  const defaultHash = await hashPassword('axon2024');
  
  if (!storedHash) {
    // Primera vez: guardar hash por defecto
    localStorage.setItem('axon_admin_hash', defaultHash);
    return input === 'axon2024';
  }
  
  const inputHash = await hashPassword(input);
  return inputHash === storedHash;
}

async function changePass() {
  const np = document.getElementById('newPassInput').value.trim();
  if (!np || np.length < 4) {
    showToast('Mínimo 4 caracteres');
    return;
  }
  const newHash = await hashPassword(np);
  localStorage.setItem('axon_admin_hash', newHash);
  document.getElementById('newPassInput').value = '';
  showToast('Contraseña actualizada ✓');
}

// 2. FUNCIÓN DE VERIFICACIÓN DE ADMIN (para proteger acciones críticas)
function requireAdmin() {
  if (!adminActive) {
    showToast('Acción no permitida: solo administradores');
    return false;
  }
  return true;
}

// 3. PROTEGER FUNCIONES CRÍTICAS
// Envolver las funciones que modifican datos importantes:

const originalPatchProducto = window.patchProducto || patchProducto;
function patchProducto(id, changes) {
  if (!requireAdmin()) return;
  return originalPatchProducto(id, changes);
}

const originalSaveConfig = window.saveConfig || saveConfig;
function saveConfig(v) {
  if (!requireAdmin()) return;
  return originalSaveConfig(v);
}

const originalPatchVale = window.patchVale || patchVale;
function patchVale(id, changes) {
  if (!requireAdmin()) return;
  return originalPatchVale(id, changes);
}

// 4. MEJORAR SEGURIDAD DE CONTRASEÑAS DE GESTORES
// (Opcional: hashear también las de gestores)
async function hashGestorPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'gestor_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Nota: Para aplicar el hash a gestores existentes necesitarías
// una migración de datos (ver abajo)

// 5. OCULTAR TOKEN DE GITHUB EN LA UI
// En lugar de mostrar el token completo, mostrar solo los últimos 4 caracteres
function maskToken(token) {
  if (!token || token.length < 8) return '••••••••';
  return '••••••••' + token.slice(-4);
}

// Ejemplo de uso en la UI:
// document.getElementById('gh-token').value = maskToken(cfg.ghToken);