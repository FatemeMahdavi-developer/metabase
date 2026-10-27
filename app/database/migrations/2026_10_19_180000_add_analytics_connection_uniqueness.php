<?php

use App\Domain\Analytics\ConnectionUniqueness;
use App\Models\AnalyticsConnection;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $schema = Schema::connection($this->getConnection());
        $schema->table('analytics_connections', function (Blueprint $table): void {
            $table->string('name_fingerprint', 64)->nullable();
            $table->string('endpoint_fingerprint', 64)->nullable();
        });

        $connection = $schema->getConnection();
        $names = [];
        $endpoints = [];
        $connection->table('analytics_connections')->orderBy('id')->chunkById(200, function ($rows) use ($connection, &$names, &$endpoints): void {
            foreach ($rows as $row) {
                $name = ConnectionUniqueness::nameFingerprint($row->name);
                $endpoint = null;
                try {
                    // Decode with the existing encrypted cast without querying the model's connection.
                    $model = (new AnalyticsConnection)->setRawAttributes(['configuration' => $row->configuration]);
                    $configuration = $model->configuration;
                    if (is_array($configuration)) {
                        $endpoint = ConnectionUniqueness::endpointFingerprint($row->driver, $configuration);
                    }
                } catch (DecryptException) {
                    // Keep unreadable legacy settings intact; they cannot identify an endpoint safely.
                }

                $nameKey = $row->owner_id.':'.$name;
                $endpointKey = $row->owner_id.':'.$endpoint;
                $connection->table('analytics_connections')->where('id', $row->id)->update([
                    'name_fingerprint' => isset($names[$nameKey]) ? null : $name,
                    'endpoint_fingerprint' => $endpoint === null || isset($endpoints[$endpointKey]) ? null : $endpoint,
                ]);
                $names[$nameKey] = true;
                if ($endpoint !== null) {
                    $endpoints[$endpointKey] = true;
                }
            }
        });

        $schema->table('analytics_connections', function (Blueprint $table): void {
            // Nullable fingerprints retain legacy duplicates and their report references.
            $table->unique(['owner_id', 'name_fingerprint'], 'analytics_connections_owner_name_unique');
            $table->unique(['owner_id', 'endpoint_fingerprint'], 'analytics_connections_owner_endpoint_unique');
        });
    }

    public function down(): void
    {
        Schema::connection($this->getConnection())->table('analytics_connections', function (Blueprint $table): void {
            $table->dropUnique('analytics_connections_owner_name_unique');
            $table->dropUnique('analytics_connections_owner_endpoint_unique');
            $table->dropColumn(['name_fingerprint', 'endpoint_fingerprint']);
        });
    }
};
