@props([
    'navigation',
])

@php
    $openSidebarClasses = 'fi-sidebar-open w-[--sidebar-width] translate-x-0 shadow-xl ring-1 ring-gray-950/5 dark:ring-white/10 rtl:-translate-x-0';
    $isRtl = __('filament-panels::layout.direction') === 'rtl';
@endphp

{{-- format-ignore-start --}}
<aside
    x-data="{}"
    @if (filament()->isSidebarCollapsibleOnDesktop() && (! filament()->hasTopNavigation()))
        x-cloak
        x-bind:class="
            $store.sidebar.isOpen
                ? @js($openSidebarClasses . ' ' . 'lg:sticky')
                : '-translate-x-full rtl:translate-x-full lg:sticky lg:translate-x-0 rtl:lg:-translate-x-0'
        "
    @else
        @if (filament()->hasTopNavigation())
            x-cloak
            x-bind:class="$store.sidebar.isOpen ? @js($openSidebarClasses) : '-translate-x-full rtl:translate-x-full'"
        @elseif (filament()->isSidebarFullyCollapsibleOnDesktop())
            x-cloak
            x-bind:class="$store.sidebar.isOpen ? @js($openSidebarClasses . ' ' . 'lg:sticky') : '-translate-x-full rtl:translate-x-full'"
        @else
            x-cloak="-lg"
            x-bind:class="
                $store.sidebar.isOpen
                    ? @js($openSidebarClasses . ' ' . 'lg:sticky')
                    : 'w-[--sidebar-width] -translate-x-full rtl:translate-x-full lg:sticky'
            "
        @endif
    @endif
    {{
        $attributes->class([
            'fi-sidebar fixed inset-y-0 start-0 z-30 flex flex-col h-screen content-start bg-white transition-all dark:bg-gray-900 lg:z-0 lg:bg-transparent lg:shadow-none lg:ring-0 lg:transition-none dark:lg:bg-transparent',
            'lg:translate-x-0 rtl:lg:-translate-x-0' => ! (filament()->isSidebarCollapsibleOnDesktop() || filament()->isSidebarFullyCollapsibleOnDesktop() || filament()->hasTopNavigation()),
            'lg:-translate-x-full rtl:lg:translate-x-full' => filament()->hasTopNavigation(),
        ])
    }}
>
    <div class="overflow-x-clip">
        <header
            class="fi-sidebar-header flex h-16 items-center bg-white px-6 ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10 lg:shadow-sm"
        >
            <div
                @if (filament()->isSidebarCollapsibleOnDesktop())
                    x-show="$store.sidebar.isOpen"
                    x-transition:enter="lg:transition lg:delay-100"
                    x-transition:enter-start="opacity-0"
                    x-transition:enter-end="opacity-100"
                @endif
            >
                @if ($homeUrl = filament()->getHomeUrl())
                    <a {{ \Filament\Support\generate_href_html($homeUrl) }}>
                        <x-filament-panels::logo />
                    </a>
                @else
                    <x-filament-panels::logo />
                @endif
            </div>

            @if (filament()->isSidebarCollapsibleOnDesktop())
                <x-filament::icon-button
                    color="gray"
                    :icon="$isRtl ? 'heroicon-o-chevron-left' : 'heroicon-o-chevron-right'"
                    {{-- @deprecated Use `panels::sidebar.expand-button.rtl` instead of `panels::sidebar.expand-button` for RTL. --}}
                    :icon-alias="$isRtl ? ['panels::sidebar.expand-button.rtl', 'panels::sidebar.expand-button'] : 'panels::sidebar.expand-button'"
                    icon-size="lg"
                    :label="__('filament-panels::layout.actions.sidebar.expand.label')"
                    x-cloak
                    x-data="{}"
                    x-on:click="$store.sidebar.open()"
                    x-show="! $store.sidebar.isOpen"
                    class="mx-auto"
                />
            @endif

            @if (filament()->isSidebarCollapsibleOnDesktop() || filament()->isSidebarFullyCollapsibleOnDesktop())
                <x-filament::icon-button
                    color="gray"
                    :icon="$isRtl ? 'heroicon-o-chevron-right' : 'heroicon-o-chevron-left'"
                    {{-- @deprecated Use `panels::sidebar.collapse-button.rtl` instead of `panels::sidebar.collapse-button` for RTL. --}}
                    :icon-alias="$isRtl ? ['panels::sidebar.collapse-button.rtl', 'panels::sidebar.collapse-button'] : 'panels::sidebar.collapse-button'"
                    icon-size="lg"
                    :label="__('filament-panels::layout.actions.sidebar.collapse.label')"
                    x-cloak
                    x-data="{}"
                    x-on:click="$store.sidebar.close()"
                    x-show="$store.sidebar.isOpen"
                    class="ms-auto hidden lg:flex"
                />
            @endif
        </header>
    </div>

    <nav
        class="fi-sidebar-nav flex-grow flex flex-col gap-y-7 overflow-y-auto overflow-x-hidden px-6 py-8"
        style="scrollbar-gutter: stable"
    >
        {{ \Filament\Support\Facades\FilamentView::renderHook(\Filament\View\PanelsRenderHook::SIDEBAR_NAV_START) }}

        @if (filament()->hasTenancy() && filament()->hasTenantMenu())
            <div
                @class([
                    'fi-sidebar-nav-tenant-menu-ctn',
                    '-mx-2' => ! filament()->isSidebarCollapsibleOnDesktop(),
                ])
                @if (filament()->isSidebarCollapsibleOnDesktop())
                    x-bind:class="$store.sidebar.isOpen ? '-mx-2' : '-mx-4'"
                @endif
            >
                <x-filament-panels::tenant-menu />
            </div>
        @endif

        <ul class="fi-sidebar-nav-groups -mx-2 flex flex-col gap-y-7">
            @foreach ($navigation as $group)
                @if (blank($group->getLabel()) && collect($group->getItems())->contains(fn ($item) => count($item->getChildItems()) > 0))
                    @foreach ($group->getItems() as $item)
                        <x-filament-panels::sidebar.group
                            :active="$item->isActive() || $item->isChildItemsActive()"
                            :icon="$item->getIcon()"
                            :items="$item->getChildItems() ?: [$item]"
                            :label="$item->getChildItems() ? $item->getLabel() : null"
                            :navigation-url="$item->getChildItems() ? $item->getUrl() : null"
                        />
                    @endforeach
                    @continue
                @endif
                <x-filament-panels::sidebar.group
                    :active="$group->isActive()"
                    :collapsible="$group->isCollapsible()"
                    :icon="$group->getIcon()"
                    :items="$group->getItems()"
                    :label="$group->getLabel()"
                    :attributes="\Filament\Support\prepare_inherited_attributes($group->getExtraSidebarAttributeBag())"
                />
            @endforeach
        </ul>

        <script data-analytics-sidebar-state>
            (() => {
                const defaultCollapsedGroups = @js(
                    collect($navigation)
                        ->filter(fn (\Filament\Navigation\NavigationGroup $group): bool => $group->isCollapsed() && $group->isCollapsible() && filled($group->getLabel()))
                        ->map(fn (\Filament\Navigation\NavigationGroup $group): string => $group->getLabel())
                        ->values()
                        ->all()
                );
                let collapsedGroups

                try {
                    collapsedGroups = JSON.parse(localStorage.getItem('collapsedGroups'))
                } catch {
                    // Older panel versions or browser extensions may leave invalid JSON.
                }

                if (!Array.isArray(collapsedGroups)) {
                    collapsedGroups = defaultCollapsedGroups
                }

                const groups = [...document.querySelectorAll('.fi-sidebar-group')]
                const fixedGroups = new Set(groups
                    .filter(group => !group.querySelector('.fi-sidebar-group-collapse-button'))
                    .map(group => group.dataset.groupLabel))

                // A group may have become non-collapsible since the last visit.
                // Keep preferences for other panels, but never hide a fixed group.
                collapsedGroups = [...new Set(collapsedGroups.filter(label =>
                    typeof label === 'string' && label.length > 0 && !fixedGroups.has(label),
                ))]

                try {
                    localStorage.setItem('collapsedGroups', JSON.stringify(collapsedGroups))
                } catch {
                    // Native navigation can still render when browser storage is unavailable.
                }

                // Livewire SPA navigation keeps the existing Alpine store alive.
                const sidebar = window.Alpine?.store?.('sidebar')
                if (sidebar) sidebar.collapsedGroups = collapsedGroups

                groups.forEach(group => {
                    const items = group.querySelector('.fi-sidebar-group-items')
                    const collapseButton = group.querySelector('.fi-sidebar-group-collapse-button')
                    if (!items || !collapseButton || !collapsedGroups.includes(group.dataset.groupLabel)) return

                    // Apply the initial collapsed state before Alpine finishes loading.
                    items.style.display = 'none'
                    collapseButton.classList.add('-rotate-180')
                })
            })()
        </script>

        {{ \Filament\Support\Facades\FilamentView::renderHook(\Filament\View\PanelsRenderHook::SIDEBAR_NAV_END) }}
    </nav>

    {{ \Filament\Support\Facades\FilamentView::renderHook(\Filament\View\PanelsRenderHook::SIDEBAR_FOOTER) }}
</aside>
{{-- format-ignore-end --}}
