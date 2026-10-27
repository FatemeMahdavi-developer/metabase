const clone = value => JSON.parse(JSON.stringify(value));
const colorValue = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : null;
const colorMap = value => Object.fromEntries(Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {}).filter(([, color]) => colorValue(color)).slice(0, 12000));

export function cleanDrillContext(context) {
    const result = { column_key: context.column_key, row_index: context.row_index ?? null, kind: context.kind || (context.row_index == null ? 'header' : 'cell') };
    if (context.result_signature) result.result_signature = context.result_signature;
    if (context.scope_fields) result.scope_fields = [...context.scope_fields];
    return result;
}

export function formatDrillNumber(value, settings = {}, display = null) {
    if (value === null || value === undefined || typeof value === 'boolean' || !Number.isFinite(Number(value))) return null;
    const requested = Number(settings.decimals ?? 0);
    const decimals = Number.isFinite(requested) ? Math.max(0, Math.min(6, Math.trunc(requested))) : 0;
    const formatted = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: decimals, minimumFractionDigits: display === 'number' ? decimals : 0 }).format(Number(value));
    return String(settings.prefix ?? '') + formatted + String(settings.suffix ?? '');
}

export function copyPresentationSettings(settings = {}) {
    const result = clone(Object.fromEntries(Object.entries(settings || {}).filter(([key, value]) => (!key.startsWith('_') || key === '_series_colors') && typeof value !== 'function')));
    if (result._series_colors) result._series_colors = colorMap(result._series_colors);
    if (result.series_colors) result.series_colors = colorMap(result.series_colors);
    return result;
}

export function clickPresentation(context = {}) {
    const result = {};
    const color = colorValue(context.color);
    if (color) result.color = color;
    if (typeof context.series_key === 'string') result.series_key = context.series_key;
    if (typeof context.series_label === 'string') result.series_label = context.series_label;
    if (typeof context.percentage === 'number' && Number.isFinite(context.percentage) && context.percentage >= 0 && context.percentage <= 100) result.percentage = context.percentage;
    return result;
}

export function captureDrillPresentation(presentation = {}, context = {}) {
    const settings = copyPresentationSettings(presentation.settings);
    let colors = { ...colorMap(settings._series_colors), ...colorMap(context.series_colors) };
    const selection = clickPresentation(context);
    if (selection.color && selection.series_key) {
        delete colors[selection.series_key];
        colors = { [selection.series_key]: selection.color, ...colors };
    }
    if (Object.keys(colors).length) settings._series_colors = colorMap(colors);
    return { display: presentation.display || 'table', settings, selection: Object.keys(selection).length ? selection : clickPresentation(presentation.selection) };
}

export function nextDrillPresentation(previous = {}, frame = {}, context = {}) {
    const presentation = captureDrillPresentation({ display: frame.display || previous.display, settings: frame.settings ?? frame.visualization_settings ?? previous.settings, selection: frame.selection ?? previous.selection }, context);
    const keys = new Set((frame.result?.columns || []).map(column => column.key));
    if (frame.result?.columns) {
        for (const key of ['x', 'y', 'split']) if (presentation.settings[key] && !keys.has(presentation.settings[key])) delete presentation.settings[key];
        if (Array.isArray(presentation.settings.visible_columns)) {
            presentation.settings.visible_columns = [...new Set(presentation.settings.visible_columns.filter(key => keys.has(key)))];
            if (!presentation.settings.visible_columns.length) delete presentation.settings.visible_columns;
        }
    }
    return presentation;
}

export function persistedPresentationSettings(settings = {}) {
    const result = copyPresentationSettings(settings);
    const colors = colorMap({ ...colorMap(result._series_colors), ...colorMap(result.series_colors) });
    delete result._series_colors;
    if (Object.keys(colors).length) result.series_colors = colors;
    return result;
}
