// ══════════════════════════════════════════
//  js/ui.js - Componentes de interfaz comunes
// ══════════════════════════════════════════

let confirmActionCb = null;

function showConfirmModal(message, onConfirm) {
  const modal = document.getElementById('confirmModal');
  const msgEl = document.getElementById('confirmMessage');
  if (!modal || !msgEl) return;

  msgEl.textContent = message;
  confirmActionCb = onConfirm;
  modal.style.display = 'flex';
}

function closeConfirmModal() {
  const modal = document.getElementById('confirmModal');
  if (modal) modal.style.display = 'none';
  confirmActionCb = null;
}

function confirmAction() {
  if (confirmActionCb) {
    confirmActionCb();
  }
  closeConfirmModal();
}

// Hacer funciones disponibles globalmente
window.showConfirmModal = showConfirmModal;
window.closeConfirmModal = closeConfirmModal;
window.confirmAction = confirmAction;