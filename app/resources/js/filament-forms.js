// Dynamic native actions can mount a textarea before the lazy loader resolves.
// Use Filament's own compiled factory; no forked textarea implementation.
import textareaFormComponent from '../../vendor/filament/forms/dist/components/textarea.js';

window.textareaFormComponent = textareaFormComponent;
const register = () => window.Alpine.data('textareaFormComponent', textareaFormComponent);
if (window.Alpine) register();
else document.addEventListener('alpine:init', register, { once: true });
