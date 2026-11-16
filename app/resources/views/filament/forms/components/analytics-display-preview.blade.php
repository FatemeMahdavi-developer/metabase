<svg viewBox="0 0 128 76" fill="none" aria-hidden="true" focusable="false" data-display-preview="{{ $display }}">
    @switch($display)
        @case('table')
            <rect x="8" y="10" width="112" height="56" rx="5" class="analytics-display-chart-grid" />
            <path d="M8 26H120M8 39H120M8 52H120M46 10V66M83 10V66" class="analytics-display-chart-grid" />
            <path d="M17 18H35M55 18H72M92 18H110" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
            <path d="M17 33H30M55 33H68M92 33H105M17 46H33M55 46H65M92 46H108M17 59H29M55 59H71M92 59H105" class="analytics-display-chart-muted" stroke-width="3" stroke-linecap="round" />
            @break
        @case('bar')
            <path d="M10 8V66H121" class="analytics-display-chart-grid" />
            <rect x="22" y="40" width="16" height="26" rx="4" fill="currentColor" opacity=".35" />
            <rect x="48" y="20" width="16" height="46" rx="4" fill="currentColor" opacity=".6" />
            <rect x="74" y="31" width="16" height="35" rx="4" fill="currentColor" opacity=".8" />
            <rect x="100" y="9" width="16" height="57" rx="4" fill="currentColor" />
            @break
        @case('line')
        @case('area')
            <path d="M10 8V66H121M10 38H121" class="analytics-display-chart-grid" />
            @if ($display === 'area')
                <path d="M13 56L34 34L54 43L75 17L95 28L117 9V66H13Z" fill="currentColor" opacity=".18" />
            @endif
            <path d="M13 56L34 34L54 43L75 17L95 28L117 9" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            @if ($display === 'line')
                <g fill="currentColor">
                    <circle cx="13" cy="56" r="3" /><circle cx="34" cy="34" r="3" /><circle cx="54" cy="43" r="3" />
                    <circle cx="75" cy="17" r="3" /><circle cx="95" cy="28" r="3" /><circle cx="117" cy="9" r="3" />
                </g>
            @endif
            @break
        @case('pie')
            <path d="M64 38V8A30 30 0 1 1 35.47 28.73Z" fill="currentColor" />
            <path d="M64 38L35.47 28.73A30 30 0 0 1 64 8Z" fill="#b49aff" />
            <path d="M64 38L88.27 55.63A30 30 0 0 1 35.47 28.73Z" fill="#8997ff" />
            @break
        @case('doughnut')
            <circle cx="64" cy="38" r="26" stroke="currentColor" stroke-width="11" />
            <circle cx="64" cy="38" r="26" stroke="#b49aff" stroke-width="11" stroke-dasharray="42 164" transform="rotate(-90 64 38)" />
            <circle cx="64" cy="38" r="26" stroke="#8997ff" stroke-width="11" stroke-dasharray="32 164" transform="rotate(2 64 38)" />
            @break
        @case('number')
            <text x="64" y="46" text-anchor="middle" fill="currentColor" font-size="32" font-weight="700" direction="ltr">1,250</text>
            <path d="M48 61H80" class="analytics-display-chart-muted" stroke-width="3" stroke-linecap="round" />
            @break
        @case('progress')
            <text x="64" y="28" text-anchor="middle" fill="currentColor" font-size="19" font-weight="700" direction="ltr">73%</text>
            <rect x="10" y="40" width="108" height="13" rx="6.5" fill="currentColor" opacity=".15" />
            <rect x="10" y="40" width="79" height="13" rx="6.5" fill="currentColor" />
            <path d="M10 64H118" class="analytics-display-chart-grid" stroke-dasharray="2 5" />
            @break
        @case('gauge')
            <path d="M24 58A40 40 0 0 1 104 58" stroke="currentColor" opacity=".15" stroke-width="12" stroke-linecap="round" />
            <path d="M24 58A40 40 0 0 1 85 24" stroke="currentColor" stroke-width="12" stroke-linecap="round" />
            <path d="M64 57L83 26" class="analytics-display-chart-needle" stroke-width="3" stroke-linecap="round" />
            <circle cx="64" cy="57" r="4" fill="currentColor" />
            @break
        @case('scatter')
            <path d="M10 8V66H121M10 38H121" class="analytics-display-chart-grid" />
            <g fill="currentColor">
                <circle cx="24" cy="52" r="4" /><circle cx="35" cy="43" r="3" /><circle cx="42" cy="56" r="4" />
                <circle cx="50" cy="30" r="4" /><circle cx="65" cy="42" r="3" /><circle cx="72" cy="22" r="4" />
                <circle cx="82" cy="35" r="3" /><circle cx="94" cy="15" r="4" /><circle cx="108" cy="25" r="4" />
            </g>
            @break
        @case('funnel')
            <path d="M10 8H118L106 23H22Z" fill="currentColor" />
            <path d="M24 27H104L92 42H36Z" fill="currentColor" opacity=".75" />
            <path d="M38 46H90L78 61H50Z" fill="currentColor" opacity=".5" />
            <path d="M52 65H76L70 73H58Z" fill="currentColor" opacity=".3" />
            @break
        @case('pivot')
            <rect x="8" y="10" width="112" height="56" rx="5" class="analytics-display-chart-grid" />
            <path d="M8 10H120V26H8ZM8 26H44V66H8Z" fill="currentColor" opacity=".15" />
            <path d="M8 26H120M8 39H120M8 52H120M44 10V66M69 10V66M94 10V66" class="analytics-display-chart-grid" />
            <g fill="currentColor">
                <rect x="50" y="31" width="12" height="4" rx="2" opacity=".3" /><rect x="75" y="31" width="12" height="4" rx="2" opacity=".6" />
                <rect x="100" y="31" width="12" height="4" rx="2" /><rect x="50" y="44" width="12" height="4" rx="2" opacity=".6" />
                <rect x="75" y="44" width="12" height="4" rx="2" /><rect x="100" y="44" width="12" height="4" rx="2" opacity=".3" />
                <rect x="50" y="57" width="12" height="4" rx="2" /><rect x="75" y="57" width="12" height="4" rx="2" opacity=".3" />
                <rect x="100" y="57" width="12" height="4" rx="2" opacity=".6" />
            </g>
            @break
    @endswitch
</svg>
