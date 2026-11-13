<?php

declare(strict_types=1);

namespace Solverr\Resource;

use Solverr\HttpClient;

final class Invoices
{
    public function __construct(private readonly HttpClient $http)
    {
    }

    /** @param array{amount: string, currency: string, order_id?: string, description?: string, redirect_url?: string, customer_email?: string, metadata?: array<string, string>, expires_in?: int} $params Send the customer to the invoice's `checkout_url`.
        @param array{idempotency_key?: string} $options */
    public function create(array $params, array $options = []): array
    {
        if (isset($params['metadata'])) {
            /** An empty or list-shaped PHP array would encode as a JSON array; the API expects an object. */
            $params['metadata'] = (object) $params['metadata'];
        }
        return $this->http->request('POST', '/api/v1/invoices', body: $params, idempotencyKey: $options['idempotency_key'] ?? null);
    }

    /** @return array<string, mixed> */
    public function retrieve(string $id): array
    {
        return $this->http->request('GET', self::path($id));
    }

    /** @param array{limit?: int, starting_after?: string, status?: string} $params
        @return array{object: string, data: list<array<string, mixed>>, has_more: bool} One page of invoices, newest first. */
    public function list(array $params = []): array
    {
        return $this->http->request('GET', '/api/v1/invoices', query: $params);
    }

    /** @param array{limit?: int, starting_after?: string, status?: string} $params
        @return \Generator<int, array<string, mixed>> Every matching invoice, newest first, fetching pages as the loop advances. */
    public function listAll(array $params = []): \Generator
    {
        while (true) {
            $page = $this->list($params);
            foreach ($page['data'] as $invoice) {
                yield $invoice;
            }
            $last = end($page['data']);
            if (!$page['has_more'] || $last === false) {
                return;
            }
            $params['starting_after'] = $last['id'];
        }
    }

    /** Marks a paid invoice as used, so it grants access only once; 409 `invalid_state` when unpaid, `already_redeemed` when used before.
        @return array{id: string, redeemed_at: string, payment: array<string, mixed>|null} `payment` is the one that paid the invoice. */
    public function redeem(string $id, array $options = []): array
    {
        return $this->http->request('POST', self::path($id) . '/redeem', idempotencyKey: $options['idempotency_key'] ?? null);
    }

    private static function path(string $id): string
    {
        return '/api/v1/invoices/' . HttpClient::pathSegment($id);
    }
}
