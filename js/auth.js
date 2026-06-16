// ══════════════════════════════════════════
//  js/auth.js - Autenticación y sesiones
// ══════════════════════════════════════════

let activeGestorId = null;
let activeMensajeroId = null;
let adminActive = false;

// Verificar contraseña admin (usa hash SHA-256)
async function checkPass(input) {
  const storedHash = localStorage.getItem('axon_admin_hash');
  const defaultHash = await hashPassword('axon2024');
  
  if (!storedHash) {
    localStorage.setItem('axon_admin_hash', defaultHash);
    return input === 'axon2024';
  }
  
  const inputHash = await hashPassword(input);
  return inputHash === storedHash;
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'axon_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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

// Funciones de login/logout (a implementar según la lógica actual)
function loginGestor(id, pass) {
  // Implementar lógica de login de gestor
}

function logoutGestor() {
  activeGestorId = null;
  // ... limpiar UI
}

function loginAdmin(pass) {
  // Implementar lógica de login admin
}

function logoutAdmin() {
  adminActive = false;
  // ... limpiar UI
}