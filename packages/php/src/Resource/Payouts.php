<?php

declare(strict_types=1);

namespace Solverr\Resource;

use Solverr\HttpClient;

final class Payouts
{
    public function __construct(private readonly HttpClient $http)
    {
    }

    /** @param array{recipient: string, asset_id: string, amount: string} $params `asset_id` comes from `tokens->list()`; the business completes the payout by signing at `sign_url`.
        @param array{idempotency_key?: string} $options */
    public function create(array $params, array $options = []): array
    {
        return $this->http->request('POST', '/api/v1/payouts', body: $params, idempotencyKey: $options['idempotency_key'] ?? null);
    }

    /** @param array{payouts: list<array{recipient: string, asset_id: string, amount: string}>} $params 1 to 200 rows, all checked before any is created.
        @return array{object: string, id: string, data: list<array<string, mixed>>} `id` is the shared `batch_id` of every payout in `data`. */
    public function createBatch(array $params, array $options = []): array
    {
        return $this->http->request('POST', '/api/v1/payouts/batch', body: $params, idempotencyKey: $options['idempotency_key'] ?? null);
    }

    /** @return array<string, mixed> */
    public function retrieve(string $id): array
    {
        return $this->http->request('GET', self::path($id));
    }

    /** @param array{limit?: int, starting_after?: string} $params
        @return array{object: string, data: list<array<string, mixed>>, has_more: bool} */
    public function list(array $params = []): array
    {
        return $this->http->request('GET', '/api/v1/payouts', query: $params);
    }

    /** Cancels a payout that was not sent. Fails with status 409 once it was sent.
        @return array<string, mixed> */
    public function cancel(string $id, array $options = []): array
    {
        return $this->http->request('POST', self::path($id) . '/cancel', body: [], idempotencyKey: $options['idempotency_key'] ?? null);
    }

    private static function path(string $id): string
    {
        return '/api/v1/payouts/' . HttpClient::pathSegment($id);
    }
}
