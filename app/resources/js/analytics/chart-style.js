import { analyticsPalette } from './theme';

export const validChartColor = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
export const chartSeriesKey = (kind, column, value, metric) => JSON.stringify(metric === undefined ? [kind, column, value ?? null] : [kind, column, value ?? null, metric]);
export const chartCategoryLabel = (value, column = {}) => value == null ? 'خالی' : value === '' ? 'متن تهی' : column.type === 'boolean' ? [true, 1, '1', 'true'].includes(value) ? 'بله' : 'خیر' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export const sanitizeSeriesColors = colors => Object.fromEntries(Object.entries(colors || {}).filter(([, value]) => validChartColor(value)).slice(0, 12000));

export function chartDefaultPalette(display, root) {
    const theme = analyticsPalette(root); const colors = theme.colors.slice();
    if (['pie', 'doughnut'].includes(display)) return [colors[1], colors[2], colors[3], colors[4], colors[5], colors[0]];
    if (['line', 'area'].includes(display) && validChartColor(theme.lineColor)) colors[0] = theme.lineColor;
    if (display === 'gauge' && validChartColor(theme.gaugeColor)) colors[0] = theme.gaugeColor;
    return colors;
}

export function chartAxes(result, settings = {}) {
    const dimensionKeys = settings._dimension_keys || [];
    const numeric = result.columns.filter(column => column.type === 'number');
    const dimensions = result.columns.filter(column => dimensionKeys.includes(column.key));
    const x = result.columns.find(column => column.key === settings.x) || dimensions[0] || result.columns.find(column => column.type !== 'number') || result.columns[0];
    const selected = settings.y ? numeric.filter(column => column.key === settings.y) : numeric.filter(column => column.key !== x?.key && !dimensionKeys.includes(column.key));
    const metrics = selected.length ? selected : numeric.filter(column => !dimensionKeys.includes(column.key));
    const split = result.columns.find(column => column.key === settings.split) || dimensions.find(column => column.key !== x?.key);
    return { x, metrics, split, numeric, dimensions };
}

export function chartColorEntries(result, display, settings = {}) {
    const { x, metrics, split } = chartAxes(result, settings);
    if (!x || !metrics.length) return [];
    const unique = rows => [...new Map(rows.map(value => [JSON.stringify(value), value])).values()];
    if (['pie', 'doughnut', 'funnel'].includes(display) || display === 'bar' && metrics.length === 1 && !split && (settings.color_by_category ?? !settings.horizontal)) {
        return unique(result.rows.map(row => row[x.key])).map(value => ({ key: chartSeriesKey('category', x.key, value), value, column: x, label: chartCategoryLabel(value, x) }));
    }
    if (split && ['bar', 'line', 'area'].includes(display)) {
        return unique(result.rows.map(row => row[split.key])).flatMap(value => metrics.map(metric => ({ key: chartSeriesKey('series', split.key, value, metric.key), value, column: split, metric, label: chartCategoryLabel(value, split) + (metrics.length > 1 ? ' · ' + metric.label : '') })));
    }
    return metrics.map(metric => ({ key: chartSeriesKey('metric', metric.key, null), column: metric, metric, label: metric.label }));
}

export function resolveSeriesColors(result, display, settings = {}, root) {
    const palette = chartDefaultPalette(display, root);
    // The old scaffold's blue was its default, rather than a chosen category color.
    if (validChartColor(settings.color) && (settings.color.toLowerCase() !== '#509ee3' || settings.color_custom)) palette[0] = settings.color;
    const colors = { ...sanitizeSeriesColors(settings._series_colors), ...sanitizeSeriesColors(settings.series_colors) };
    const entries = chartColorEntries(result, display, settings);
    const assigned = Object.keys(colors).length;
    let next = assigned;
    for (const entry of entries) if (!validChartColor(colors[entry.key])) colors[entry.key] = palette[next++ % palette.length];
    return colors;
}

export function applyChartTheme(chart, root) {
    const palette = analyticsPalette(root);
    chart.options.color = palette.muted;
    chart.options.font = { ...chart.options.font, family: palette.fontFamily };
    for (const dataset of chart.data.datasets) if (dataset._analyticsThemeFill) dataset.backgroundColor = palette.fill;
    if (chart.options.scales) for (const axis of Object.values(chart.options.scales)) {
        if (axis.ticks) { axis.ticks.color = palette.muted; axis.ticks.font = { ...axis.ticks.font, family: palette.fontFamily }; }
        if (axis.title) { axis.title.color = palette.text; axis.title.font = { ...axis.title.font, family: palette.fontFamily }; }
        if (axis.grid) axis.grid.color = palette.grid;
        if (axis.border) axis.border.color = palette.grid;
    }
    const legend = chart.options.plugins?.legend;
    if (legend?.labels) { legend.labels.color = palette.muted; legend.labels.font = { ...legend.labels.font, family: palette.fontFamily }; }
    const tooltip = chart.options.plugins?.tooltip;
    if (tooltip) {
        tooltip.backgroundColor = palette.tooltipBg;
        tooltip.titleColor = palette.tooltipText;
        tooltip.bodyColor = palette.tooltipText;
        tooltip.borderColor = palette.grid;
        for (const key of ['titleFont', 'bodyFont', 'footerFont']) tooltip[key] = { ...tooltip[key], family: palette.fontFamily };
    }
    chart.update('none');
}

