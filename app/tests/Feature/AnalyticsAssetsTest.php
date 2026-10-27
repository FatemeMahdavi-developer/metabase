<?php

namespace Tests\Feature;

use App\Support\AnalyticsAssets;
use Illuminate\Foundation\Vite;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AnalyticsAssetsTest extends TestCase
{
    private string $fixtureDirectory;

    private string $buildDirectory;

    private string $hotFile;

    private Vite $vite;

    protected function setUp(): void
    {
        parent::setUp();

        $this->buildDirectory = 'analytics-assets-test-'.bin2hex(random_bytes(8));
        $this->fixtureDirectory = public_path($this->buildDirectory);
        File::makeDirectory($this->fixtureDirectory.'/assets', 0755, true);
        File::put($this->fixtureDirectory.'/manifest.json', json_encode([
            'resources/js/filament-forms.js' => [
                'file' => 'assets/filament-forms-fixture.js',
                'src' => 'resources/js/filament-forms.js',
                'isEntry' => true,
            ],
            'resources/js/analytics.js' => [
                'file' => 'assets/analytics-fixture.js',
                'src' => 'resources/js/analytics.js',
                'isEntry' => true,
                'css' => ['assets/analytics-fixture.css'],
            ],
            'resources/css/panel-theme.css' => [
                'file' => 'assets/panel-theme-fixture.css',
                'src' => 'resources/css/panel-theme.css',
                'isEntry' => true,
            ],
        ], JSON_THROW_ON_ERROR));
        File::put($this->fixtureDirectory.'/assets/analytics-fixture.js', 'export {};');
        File::put($this->fixtureDirectory.'/assets/analytics-fixture.css', ':root {}');
        File::put($this->fixtureDirectory.'/assets/filament-forms-fixture.js', 'export {};');
        File::put($this->fixtureDirectory.'/assets/panel-theme-fixture.css', ':root {}');

        // Never create, replace or remove the application's actual public/hot.
        $this->hotFile = tempnam(sys_get_temp_dir(), 'analytics-vite-test-');
        File::put($this->hotFile, 'http://[::1]:5173');
        $this->vite = $this->app->make(Vite::class)
            ->useHotFile($this->hotFile)
            ->useBuildDirectory($this->buildDirectory);
    }

    protected function tearDown(): void
    {
        if (isset($this->hotFile) && is_file($this->hotFile)) {
            File::delete($this->hotFile);
        }

        if (isset($this->fixtureDirectory) && is_dir($this->fixtureDirectory)) {
            $publicDirectory = realpath(public_path());
            $fixtureDirectory = realpath($this->fixtureDirectory);

            // Restrict recursive cleanup to this test's exact generated directory.
            if ($fixtureDirectory !== false
                && dirname($fixtureDirectory) === $publicDirectory
                && basename($fixtureDirectory) === $this->buildDirectory
                && str_starts_with($this->buildDirectory, 'analytics-assets-test-')) {
                File::deleteDirectory($fixtureDirectory);
            }
        }

        parent::tearDown();
    }

    public static function networkUrls(): array
    {
        return [
            'LAN address' => ['http://192.168.54.7:8000'],
            'intranet hostname' => ['http://analytics.intranet:8000'],
            'IPv6 LAN address' => ['http://[fd00::1234]:8000'],
        ];
    }

    #[DataProvider('networkUrls')]
    public function test_network_requests_use_compiled_assets_despite_a_stale_loopback_hot_file(string $url): void
    {
        $this->bindRequest($url, 'local');

        $html = $this->assetTags();

        $this->assertCompiledAssets($html);
        $this->assertStringNotContainsString('http://[::1]:5173', $html);
        $this->assertStringNotContainsString('@vite/client', $html);
    }

    public function test_production_requests_use_compiled_assets_even_on_localhost(): void
    {
        $this->bindRequest('http://localhost:8000', 'production');

        $html = $this->assetTags();

        $this->assertCompiledAssets($html);
        $this->assertStringNotContainsString('@vite/client', $html);
    }

    public static function loopbackUrls(): array
    {
        return [
            'localhost' => ['http://localhost:8000'],
            'IPv4 loopback' => ['http://127.0.0.1:8000'],
            'IPv6 loopback' => ['http://[::1]:8000'],
        ];
    }

    #[DataProvider('loopbackUrls')]
    public function test_local_development_on_loopback_uses_compiled_assets_by_default(string $url): void
    {
        $this->bindRequest($url, 'local');

        $html = $this->assetTags();

        $this->assertCompiledAssets($html);
        $this->assertStringNotContainsString('@vite/client', $html);
    }

    public function test_hmr_can_be_explicitly_enabled_for_local_loopback_development(): void
    {
        config()->set('analytics.vite_hmr', true);
        $this->bindRequest('http://127.0.0.1:8000', 'local');

        $html = $this->assetTags();

        $this->assertStringContainsString('http://[::1]:5173/@vite/client', $html);
        $this->assertStringContainsString('http://[::1]:5173/resources/js/analytics.js', $html);
        $this->assertStringContainsString('http://[::1]:5173/resources/css/panel-theme.css', $html);
    }

    public function test_local_development_without_a_hot_file_uses_the_configured_build(): void
    {
        File::delete($this->hotFile);
        $this->bindRequest('http://127.0.0.1:8000', 'local');

        $html = $this->assetTags();

        $this->assertCompiledAssets($html);
        $this->assertStringNotContainsString('@vite/client', $html);
    }

    public function test_compiled_rendering_preserves_csp_nonce_callbacks_and_the_original_vite_configuration(): void
    {
        $this->bindRequest('http://192.168.54.7:8000', 'local');
        $this->vite->useCspNonce('analytics-assets-fixture-nonce');
        $this->vite->useScriptTagAttributes(['data-analytics-fixture' => 'preserved']);

        $html = $this->assetTags();

        $this->assertCompiledAssets($html);
        $this->assertStringContainsString('nonce="analytics-assets-fixture-nonce"', $html);
        $this->assertStringContainsString('data-analytics-fixture="preserved"', $html);
        $this->assertSame($this->vite, $this->app->make(Vite::class));
        $this->assertSame($this->hotFile, $this->vite->hotFile());
        $this->assertSame('analytics-assets-fixture-nonce', $this->vite->cspNonce());
        $this->assertTrue($this->vite->isRunningHot());
        $this->assertSame('http://[::1]:5173', File::get($this->hotFile));

        // A separate consumer of the configured Vite instance must still get HMR.
        $originalHtml = $this->vite->__invoke(['resources/js/analytics.js'])->toHtml();
        $this->assertStringContainsString('http://[::1]:5173/@vite/client', $originalHtml);
        $this->assertStringContainsString('nonce="analytics-assets-fixture-nonce"', $originalHtml);
    }

    private function bindRequest(string $url, string $environment): void
    {
        $this->app['env'] = $environment;
        $this->app->instance('request', Request::create($url.'/admin/analytics/dashboards'));
    }

    private function assetTags(): string
    {
        return $this->app->make(AnalyticsAssets::class)->tags([
            'resources/js/analytics.js',
            'resources/css/panel-theme.css',
        ])->toHtml();
    }

    private function assertCompiledAssets(string $html): void
    {
        $this->assertStringContainsString('/'.$this->buildDirectory.'/assets/analytics-fixture.js', $html);
        $this->assertStringContainsString('/'.$this->buildDirectory.'/assets/analytics-fixture.css', $html);
        $this->assertStringContainsString('/'.$this->buildDirectory.'/assets/panel-theme-fixture.css', $html);
    }
}
