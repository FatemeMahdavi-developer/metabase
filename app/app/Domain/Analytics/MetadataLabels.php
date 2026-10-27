<?php

namespace App\Domain\Analytics;

/** Display names never replace physical identifiers or saved query aliases. */
class MetadataLabels
{
    public static function catalog(array $catalog, array $metadata = [], ?string $database = null): array
    {
        foreach ($catalog as &$table) {
            if (! empty($table['virtual'])) {
                $table = self::alias($table);
                $table['fields'] = array_map(fn ($field) => self::virtual($field), $table['fields']);

                continue;
            }
            // A catalog can be projected repeatedly (or for an edited connection).
            // Restore the base translations before adding the current prefix.
            $previousPrefix = $table['display_prefix'] ?? '';
            if ($previousPrefix !== '') {
                foreach (['fa', 'en'] as $language) {
                    $name = $table['display_names'][$language] ?? '';
                    if (str_starts_with($name, $previousPrefix)) {
                        $table['display_names'][$language] = substr($name, strlen($previousPrefix));
                    }
                }
            }
            unset($table['display_prefix']);
            $overrides = $metadata[$table['key']] ?? [];
            // Physical database objects are displayed with their exact catalog
            // identifiers. Translations remain metadata only and never replace
            // the default table/column name in the workbench.
            $table['description'] = array_key_exists('description', $overrides) ? ($overrides['description'] ?? '') : ($table['description'] ?? '');
            $table = self::physical($table, $overrides);
            $table['label'] = $table['key'];
            if ($database !== null && $database !== '') {
                $schema = $table['schema'] ?? (str_contains($table['key'], '.') ? strstr($table['key'], '.', true) : '');
                $name = $schema !== '' && str_starts_with($table['key'], $schema.'.') ? substr($table['key'], strlen($schema) + 1) : $table['key'];
                $prefix = $database.'.'.($schema !== '' && $schema !== 'public' ? $schema.'.' : '');
                foreach ($table['display_names'] as $language => $label) {
                    $table['display_names'][$language] = $prefix.($label === $table['key'] ? $name : $label);
                }
                $table['display_prefix'] = $prefix;
            }
            foreach ($table['fields'] as &$field) {
                $custom = $overrides['fields'][$field['key']] ?? [];
                $field['description'] = array_key_exists('description', $custom) ? ($custom['description'] ?? '') : ($field['description'] ?? '');
                $field['hidden'] = $custom['hidden'] ?? $field['hidden'] ?? false;
                $field['semantic_type'] = array_key_exists('semantic_type', $custom) ? $custom['semantic_type'] : ($field['semantic_type'] ?? null);
                $field = self::physical($field, $custom);
                $field['label'] = $field['key'];
            }
            unset($field);
        }
        unset($table);

        return $catalog;
    }

    public static function physical(array $entity, array $metadata = []): array
    {
        $original = $entity['key'];
        $translations = $metadata['labels'] ?? [];
        $legacy = $metadata['label'] ?? null;
        if ($legacy === null && preg_match('/\p{Arabic}/u', $entity['label'] ?? '')) {
            $legacy = $entity['label'];
        }
        $legacyLanguage = is_string($legacy) && $legacy !== '' ? (preg_match('/\p{Arabic}/u', $legacy) ? 'fa' : 'en') : null;
        $names = ['original' => $original];
        foreach (['fa', 'en'] as $language) {
            if (array_key_exists($language, $translations)) {
                $names[$language] = is_string($translations[$language]) && trim($translations[$language]) !== '' ? $translations[$language] : $original;
            } else {
                $names[$language] = $legacyLanguage === $language ? $legacy : ($entity['display_names'][$language] ?? $original);
            }
        }

        return [...$entity, 'original_name' => $original, 'display_names' => $names, 'label_kind' => 'physical'];
    }

    public static function alias(array $entity): array
    {
        $label = $entity['label'] ?? $entity['key'];

        return [...$entity, 'original_name' => $entity['original_name'] ?? $entity['key'], 'display_names' => array_fill_keys(['original', 'fa', 'en'], $label), 'label_kind' => 'alias'];
    }

    public static function virtual(array $entity): array
    {
        if (($entity['label_kind'] ?? null) === 'alias' || ! empty($entity['computed']) || ($entity['role'] ?? null) === 'metric') {
            return self::alias($entity);
        }

        return isset($entity['display_names']) ? $entity : self::physical($entity);
    }

    public static function joined(array $field, array $table, string $key): array
    {
        $names = ['original' => $key];
        foreach (['fa', 'en'] as $language) {
            $names[$language] = ($table['display_names'][$language] ?? $table['key']).' → '.($field['display_names'][$language] ?? $field['key']);
        }

        return [...$field, 'key' => $key, 'original_name' => $key, 'display_names' => $names, 'label_kind' => 'physical'];
    }

    public static function stage(array $field, string $target, int $number): array
    {
        $prefix = 'مرحلهٔ '.$number.' → ';
        if (($field['label_kind'] ?? null) === 'alias') {
            return self::alias([...$field, 'key' => $target, 'original_name' => $target, 'label' => $prefix.$field['label']]);
        }
        $names = ['original' => $target];
        foreach (['fa', 'en'] as $language) {
            $names[$language] = $prefix.($field['display_names'][$language] ?? $field['label']);
        }

        return [...$field, 'key' => $target, 'label' => $prefix.$field['label'], 'original_name' => $target, 'display_names' => $names];
    }

    public static function titleNames(array $entity, string $prefix = '', string $suffix = ''): array
    {
        $names = $entity['display_names'] ?? array_fill_keys(['original', 'fa', 'en'], $entity['label'] ?? $entity['key']);

        return array_map(fn ($name) => $prefix.$name.$suffix, $names);
    }
}
