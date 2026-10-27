export const metadataLanguages = ['original', 'fa', 'en'];
export const validMetadataLanguage = value => metadataLanguages.includes(value);

// Data values, SQL and saved definitions are never display-name metadata.
const unchangedKeys = new Set(['rows', 'row', 'value', 'values', 'query_definition', 'definition', 'field_labels', 'parameters', 'settings', 'visualization_settings', 'configuration']);

export function projectMetadataNames(value, language = 'original') {
    const mode = validMetadataLanguage(language) ? language : 'original';
    if (Array.isArray(value)) return value.map(row => projectMetadataNames(row, mode));
    if (!value || typeof value !== 'object') return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unchangedKeys.has(key) ? item : projectMetadataNames(item, mode)]));
    const names = value.display_names;
    if (names && typeof names.original === 'string' && typeof value.label_kind === 'string') {
        const label = value.label_kind === 'alias' ? value.label ?? names.original : names[mode] || names.original;
        if (typeof label === 'string') {
            result.label = label;
            if (Object.hasOwn(value, 'column_label')) result.column_label = label;
            if (Object.hasOwn(value, 'table_label')) result.table_label = label;
        }
    }
    return result;
}

export const normalizeMetadataSearch = value => String(value || '').replaceAll('ي', 'ی').replaceAll('ك', 'ک').toLocaleLowerCase().trim();
export const metadataSearchText = row => normalizeMetadataSearch([row.key, row.original_name, row.label, ...Object.values(row.display_names || {})].filter(Boolean).join(' '));

export function joinedMetadataField(field, table, key, language = 'original') {
    const display_names = { original: key };
    for (const mode of ['fa', 'en']) {
        display_names[mode] = `${table.display_names?.[mode] || table.key} → ${field.display_names?.[mode] || field.key}`;
    }
    return projectMetadataNames({ ...field, key, original_name: key, display_names, label_kind: 'physical' }, language);
}
