const activeModals = new WeakMap();
let modalGeneration = 0;

// The native window persists after dismissal; DOM connectivity alone cannot
// distinguish an outstanding request from the next editor using that window.
export function isCurrentFilamentModal(modal, generation) {
    return Boolean(generation && modal?.isConnected && modal.hasAttribute('open') && modal.dataset.analyticsModalGeneration === generation);
}

function notify(root, modal, reason) {
    root.dispatchEvent(new CustomEvent('analytics-modal-closed', { detail: { modal, reason } }));
}

function modalEvent(name, id) {
    window.dispatchEvent(new CustomEvent(name, { detail: { id } }));
}

function reset(active) {
    const { modal, shell } = active;
    modal.removeAttribute('open');
    // Dialog-specific state and listeners must not leak into the next editor.
    for (const attribute of [...modal.attributes]) {
        if (attribute.name.startsWith('data-') && attribute.name !== 'data-analytics-modal-window') modal.removeAttribute(attribute.name);
    }
    modal.className = active.initialClasses;
    shell.querySelector('[data-analytics-modal-body]')?.replaceChildren();
    shell.querySelector('[data-analytics-modal-footer]')?.replaceChildren();
    const error = shell.querySelector('.mb-dialog-error');
    if (error) error.textContent = '';
}

export function openFilamentModal(root, { title, body, footer = '', wide = false, side = false, modeless = false }) {
    closeFilamentModal(root);
    const variant = side ? 'slide-over' : 'dialog';
    const modal = root.querySelector(`[data-analytics-modal-window="${variant}"]`);
    if (!modal) throw new Error('The Filament analytics modal host is missing.');
    const shell = modal.closest('.fi-modal');
    if (!shell) throw new Error('The Filament analytics modal shell is missing.');
    const id = shell.dataset.fiModalId;
    const active = { modal, shell, id, initialClasses: modal.className };

    // Notebook modules attach listeners directly to the window. Replace the content
    // nodes, then clear these listeners on close without replacing Alpine's window.
    active.controller = new AbortController();
    activeModals.set(root, active);
    modal.classList.add('mb-dialog');
    modal.classList.toggle('wide', wide);
    modal.classList.toggle('side', side);
    modal.setAttribute('open', '');
    modal.dataset.analyticsModalGeneration = String(++modalGeneration);
    modal.dir = 'rtl';
    modal.dataset.nativeFilament = 'true';
    // The old modeless drawer is now a native Filament slide-over, with the
    // same dismissal and focus behavior as other panel dialogs.
    if (modeless) modal.dataset.analyticsPicker = 'true';
    const titleElement = shell.querySelector('[data-analytics-modal-title]');
    const bodyElement = shell.querySelector('[data-analytics-modal-body]');
    const footerElement = shell.querySelector('[data-analytics-modal-footer]');
    if (!titleElement || !bodyElement || !footerElement) throw new Error('The Filament analytics modal template is incomplete.');
    titleElement.textContent = title;
    bodyElement.innerHTML = body;
    footerElement.innerHTML = footer;
    const form = shell.querySelector('[data-analytics-modal-form]');
    if (form?.id) {
        shell.querySelectorAll('[data-analytics-modal-footer] input, [data-analytics-modal-footer] select, [data-analytics-modal-footer] textarea, [data-analytics-modal-footer] button')
            .forEach(control => control.setAttribute('form', form.id));
    }
    const nativeFooter = shell.querySelector('.fi-modal-footer');
    if (nativeFooter) nativeFooter.hidden = !footer;
    modal.querySelector('.fi-modal-header')?.classList.add('mb-dialog-header');

    const originalAddListener = modal.addEventListener;
    modal.addEventListener = function (type, listener, options) {
        const listenerOptions = typeof options === 'boolean' ? { capture: options } : { ...options };
        return originalAddListener.call(this, type, listener, { ...listenerOptions, signal: active.controller.signal });
    };
    active.originalAddListener = originalAddListener;

    const container = shell.querySelector('[x-ref="modalContainer"]');
    if (!container) throw new Error('The Filament modal container is missing.');
    container.addEventListener('modal-closed', () => {
        if (activeModals.get(root) !== active) return;
        activeModals.delete(root);
        active.controller.abort();
        modal.addEventListener = originalAddListener;
        notify(root, modal, 'dismiss');
        reset(active);
    }, { signal: active.controller.signal });
    modalEvent('open-modal', id);
    return modal;
}

export function closeFilamentModal(root) {
    const active = activeModals.get(root);
    if (!active) return;
    activeModals.delete(root);
    active.controller.abort();
    active.modal.addEventListener = active.originalAddListener;
    // Notify while the body still exists so the caller can cancel searches,
    // expression validation and detail-view subscriptions.
    notify(root, active.modal, 'programmatic');
    modalEvent('close-modal', active.id);
    reset(active);
}
