<?php

namespace App\Support;

use Illuminate\Contracts\Support\Htmlable;
use Illuminate\Foundation\Vite;

class AnalyticsAssets
{
    public function tags(array $entrypoints): Htmlable
    {
        // Keep the application's configured build directory, CSP nonce and asset
        // callbacks, without changing the Vite instance used by other pages.
        $vite = clone app(Vite::class);
        $host = strtolower(trim(request()->getHost(), '[]'));
        $hmrEnabled = (bool) config('analytics.vite_hmr', false)
            && app()->environment('local')
            && in_array($host, ['localhost', '127.0.0.1', '::1'], true);

        if (! $hmrEnabled) {
            // A copied public/hot can point LAN browsers at their own localhost.
            // An empty hot-file path disables HMR for this renderer only.
            $vite->useHotFile('');
        }

        return $vite($entrypoints);
    }
}
