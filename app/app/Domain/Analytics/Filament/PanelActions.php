<?php

namespace App\Domain\Analytics\Filament;

use App\Http\Controllers\AnalyticsController;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsReport;
use Filament\Facades\Filament;
use Filament\Forms\Form;
use Filament\Notifications\Notification;
use Filament\Support\Exceptions\Halt;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/** Adapts native panel actions to the same authorization and validation as the API. */
class PanelActions
{
    public function createDashboard(array $data): AnalyticsDashboard
    {
        return AnalyticsDashboard::findOrFail($this->call('dashboardCreate', $data)['id']);
    }

    public function saveConnection(array $data, ?AnalyticsConnection $record = null): AnalyticsConnection
    {
        return AnalyticsConnection::findOrFail($this->call('connectionSave', $data, $record)['id']);
    }

    public function connectionFormData(AnalyticsConnection $record): array
    {
        $configuration = $record->configuration;
        unset($configuration['password']);

        return ['name' => $record->name, 'driver' => $record->driver, 'configuration' => $configuration];
    }

    public function testConnection(AnalyticsConnection $record): array
    {
        return $this->call('connectionTest', [...$this->connectionFormData($record), 'connection_id' => $record->id]);
    }

    public function syncConnection(AnalyticsConnection $record): array
    {
        return $this->call('connectionSync', [], $record);
    }

    public function deleteConnection(AnalyticsConnection $record): bool
    {
        $this->call('connectionDelete', [], $record);

        return true;
    }

    public function updateReportMetadata(AnalyticsReport $record, array $data): AnalyticsReport
    {
        $this->call('reportSave', [
            ...$record->only(['name', 'description', 'folder_id', 'query_definition', 'display', 'visualization_settings', 'version']),
            ...array_intersect_key($data, array_flip(['name', 'description', 'folder_id', 'version'])),
        ], $record);

        return $record->refresh();
    }

    public function deleteReport(AnalyticsReport $record): bool
    {
        $this->call('reportDelete', [], $record);

        return true;
    }

    public function copyReport(AnalyticsReport $record, array $data): AnalyticsReport
    {
        abort_unless($record->exists && $record->owner_id === (int) Filament::auth()->id(), 403);
        $payload = [
            ...$record->only(['name', 'description', 'folder_id', 'query_definition', 'display', 'visualization_settings']),
            ...array_intersect_key($data, array_flip(['name', 'description', 'folder_id'])),
        ];

        return AnalyticsReport::findOrFail($this->call('reportSave', $payload)['id']);
    }

    public function deleteDashboard(AnalyticsDashboard $record): bool
    {
        $this->call('dashboardDelete', [], $record);

        return true;
    }

    public function copyDashboard(AnalyticsDashboard $record, bool $copyReports): AnalyticsDashboard
    {
        return AnalyticsDashboard::findOrFail($this->call('dashboardCopy', ['copy_reports' => $copyReports], $record)['id']);
    }

    public function createFolder(array $data): array
    {
        return $this->call('folderSave', $data);
    }

    public function withForm(Form $form, callable $operation): mixed
    {
        try {
            return $operation();
        } catch (ValidationException $exception) {
            Notification::make()->title('ذخیره انجام نشد')->body(collect($exception->errors())->flatten()->first())->danger()->send();
            $errors = [];
            $fields = $form->getFlatFields(withHidden: true);
            foreach ($exception->errors() as $key => $messages) {
                if (! isset($fields[$key]) && isset($fields['configuration.'.$key])) {
                    $key = 'configuration.'.$key;
                }
                $errors[trim($form->getStatePath().'.'.$key, '.')] = $messages;
            }
            throw ValidationException::withMessages($errors);
        }
    }

    public function withoutForm(callable $operation): mixed
    {
        try {
            return $operation();
        } catch (ValidationException $exception) {
            Notification::make()->title('عملیات انجام نشد')->body(collect($exception->errors())->flatten()->first())->danger()->send();
            throw new Halt;
        }
    }

    private function call(string $method, array $data, ?Model $record = null): array
    {
        abort_unless($user = Filament::auth()->user(), 403);
        $request = Request::create('/analytics/panel-action', 'POST', $data);
        $request->setUserResolver(fn () => $user);

        try {
            return app(AnalyticsController::class)->{$method}($request, ...($record ? [$record] : []));
        } catch (HttpExceptionInterface $exception) {
            if (! in_array($exception->getStatusCode(), [409, 422], true)) {
                throw $exception;
            }

            throw ValidationException::withMessages(['name' => $exception->getMessage() ?: 'عملیات امکان‌پذیر نیست.']);
        }
    }
}
