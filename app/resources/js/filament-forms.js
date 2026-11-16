// Dynamic native actions can mount a textarea before the lazy loader resolves.
// Use Filament's own compiled factory; no forked textarea implementation.
import textareaFormComponent from '../../vendor/filament/forms/dist/components/textarea.js';

window.textareaFormComponent = textareaFormComponent;
// Read Livewire's reactive draft; styling must not change or submit field state.
export const soarFloatingField = statePath => ({
    init() {
        // Custom resource actions share the create/edit field theme.
        this.$el.closest(".fi-modal-window")?.parentElement?.classList.add("soar-form-modal");
    },
    get hasValue() {
        const value = this.$wire.$get(statePath);
        return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== '';
    },
});

function preserveFloatingModalTheme() {
    // Livewire replaces server-rendered container attributes after validation.
    window.Livewire.hook('morph.updated', ({ el }) => {
        if (el.matches('[x-ref="modalContainer"]') && el.querySelector('.soar-floating-field')) {
            el.classList.add('soar-form-modal');
        }
    });
}
if (window.Livewire) preserveFloatingModalTheme();
else document.addEventListener('livewire:init', preserveFloatingModalTheme, { once: true });

const register = () => {
    window.Alpine.data('textareaFormComponent', textareaFormComponent);
    window.Alpine.data('soarFloatingField', soarFloatingField);
};
if (window.Alpine) register();
else document.addEventListener('alpine:init', register, { once: true });
