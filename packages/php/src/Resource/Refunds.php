<?php

declare(strict_types=1);

namespace Solverr\Resource;

use Solverr\HttpClient;

final class Refunds
{
    public function __construct(private readonly HttpClient $http)
    {
    }

    /** Creates a refund of the payment that paid the invoice, or of `payment_id`; the business completes it by signing at `sign_url`.
        @param array{invoice_id: string, payment_id?: string, amount?: string} $params `amount` in the settlement coin; omit to refund the rest. */
    public function create(array $params, array $options = []): array
    {
        return $this->http->request('POST', '/api/v1/refunds', body: $params, idempotencyKey: $options['idempotency_key'] ?? null);
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
        return $this->http->request('GET', '/api/v1/refunds', query: $params);
    }

    /** Cancels a refund that was not sent; its amount can then be refunded again. Fails with status 409 once it was sent.
        @return array<string, mixed> */
    public function cancel(string $id, array $options = []): array
    {
        return $this->http->request('POST', self::path($id) . '/cancel', body: [], idempotencyKey: $options['idempotency_key'] ?? null);
    }

    private static function path(string $id): string
    {
        return '/api/v1/refunds/' . HttpClient::pathSegment($id);
    }
}
