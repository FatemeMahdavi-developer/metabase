import { analyticsPalette } from './theme';

export const validChartColor = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
export const chartSeriesKey = (kind, column, value, metric) => JSON.stringify(metric === undefined ? [kind, column, value ?? null] : [kind, column, value ?? null, metric]);
export const chartCategoryLabel = (value, column = {}) => value == null ? 'خالی' : value === '' ? 'متن تهی' : column.type === 'boolean' ? [true, 1, '1', 'true'].includes(value) ? 'بله' : 'خیر' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export const sanitizeSeriesColors = colors => Object.fromEntries(Object.entries(colors || {}).filter(([, value]) => validChartColor(value)).slice(0, 12000));

export function hasCustomChartColor(settings = {}) {
    return validChartColor(settings.color) && (settings.color_custom === true || settings.color_custom !== false && settings.color.toLowerCase() !== '#509ee3');
}

export function chartDefaultPalette(display, root, settings = {}) {
    const theme = analyticsPalette(root); const colors = theme.colors.slice();
    if (display === 'bar') return settings.horizontal
        ? [theme.lineColor, theme.horizontalSecondary, ...colors.slice(2)]
        : theme.bars;
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
    const palette = chartDefaultPalette(display, root, settings);
    if (hasCustomChartColor(settings)) palette[0] = settings.color;
    const explicit = sanitizeSeriesColors(settings.series_colors);
    const colors = { ...sanitizeSeriesColors(settings._series_colors), ...explicit };
    // Keep automatic slots separate from chosen colors so defaults follow the theme.
    const slots = settings._series_color_indexes ||= {};
    let next = Math.max(-1, ...Object.values(slots).filter(Number.isInteger)) + 1;
    for (const entry of chartColorEntries(result, display, settings)) {
        if (validChartColor(explicit[entry.key])) {
            if (!Number.isInteger(slots[entry.key])) slots[entry.key] = next++;
            continue;
        }
        if (!Number.isInteger(slots[entry.key])) {
            if (validChartColor(colors[entry.key])) continue; // Inherited drill color.
            slots[entry.key] = next++;
        }
        colors[entry.key] = palette[slots[entry.key] % palette.length];
    }
    return colors;
}

export function chartAreaFill(context, root) {
    const palette = analyticsPalette(root);
    const area = context.chart.chartArea;
    if (!area) return palette.fill;
    const gradient = context.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    gradient.addColorStop(0, palette.card);
    gradient.addColorStop(1, palette.fill);
    return gradient;
}

export function applyChartTheme(chart, root) {
    if (!chart?.ctx || !chart.canvas?.isConnected) return;
    const palette = analyticsPalette(root);
    chart.options.color = palette.muted;
    chart.options.font = { ...chart.options.font, family: palette.fontFamily };
    const rendered = root._analyticsVisualization;
    if (rendered) {
        const { result, display, settings } = rendered;
        const resolved = resolveSeriesColors(result, display, settings, root);
        const colors = settings._series_colors ||= {};
        Object.assign(colors, resolved);
        const { x } = chartAxes(result, settings);
        const primary = hasCustomChartColor(settings) ? settings.color : chartDefaultPalette(display, root, settings)[0];
        for (const dataset of chart.data.datasets) {
            const color = colors[dataset._seriesKey] || primary;
            const categoryColors = dataset._categoryColors
                ? result.rows.map(row => colors[chartSeriesKey('category', x.key, row[x.key])] || primary) : null;
            dataset.borderColor = categoryColors || color;
            dataset.backgroundColor = categoryColors || (dataset._analyticsThemeFill ? context => chartAreaFill(context, root) : color + (display === 'area' ? '22' : ''));
            dataset.hoverBackgroundColor = categoryColors || undefined;
            dataset.pointBackgroundColor = color;
        }
    }
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

