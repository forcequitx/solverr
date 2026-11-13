<?php

declare(strict_types=1);

namespace Solverr\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use Solverr\Client;

/** Each resource method against a local server: HTTP method, encoded path, JSON body and idempotency key. */
final class ResourcesTest extends ServerTestCase
{
    private const PAYOUT = ['recipient' => 'alice.near', 'asset_id' => 'nep141:usdc', 'amount' => '1'];

    private static function client(): Client
    {
        return new Client(['api_key' => self::API_KEY, 'base_url' => self::$server->baseUrl]);
    }

    /** @return iterable<string, array{\Closure(Client): mixed, string, string, ?string}> Call, method, path and exact JSON body (null for none). */
    public static function calls(): iterable
    {
        yield 'invoices create' => [fn (Client $c) => $c->invoices->create(['amount' => '25.00', 'currency' => 'USD', 'description' => null]), 'POST', '/api/v1/invoices', '{"amount":"25.00","currency":"USD"}'];
        yield 'invoices create with metadata' => [fn (Client $c) => $c->invoices->create(['amount' => '1.00', 'currency' => 'EUR', 'metadata' => ['wc_order_id' => '7']]), 'POST', '/api/v1/invoices', '{"amount":"1.00","currency":"EUR","metadata":{"wc_order_id":"7"}}'];
        yield 'invoices create with empty metadata' => [fn (Client $c) => $c->invoices->create(['amount' => '1.00', 'currency' => 'USD', 'metadata' => []]), 'POST', '/api/v1/invoices', '{"amount":"1.00","currency":"USD","metadata":{}}'];
        yield 'invoices retrieve' => [fn (Client $c) => $c->invoices->retrieve('inv/1'), 'GET', '/api/v1/invoices/inv%2F1', null];
        yield 'invoices list' => [fn (Client $c) => $c->invoices->list(['limit' => 10, 'status' => 'paid']), 'GET', '/api/v1/invoices?limit=10&status=paid', null];
        yield 'invoices redeem' => [fn (Client $c) => $c->invoices->redeem('inv_1'), 'POST', '/api/v1/invoices/inv_1/redeem', null];
        yield 'payment links create' => [fn (Client $c) => $c->paymentLinks->create(['title' => 'Tip', 'currency' => 'USD']), 'POST', '/api/v1/payment-links', '{"title":"Tip","currency":"USD"}'];
        yield 'payment links list' => [fn (Client $c) => $c->paymentLinks->list(['starting_after' => 'pl_9']), 'GET', '/api/v1/payment-links?starting_after=pl_9', null];
        yield 'payment links deactivate' => [fn (Client $c) => $c->paymentLinks->deactivate('pl_1'), 'DELETE', '/api/v1/payment-links/pl_1', null];
        yield 'refunds create' => [fn (Client $c) => $c->refunds->create(['invoice_id' => 'inv_1', 'amount' => '0.5']), 'POST', '/api/v1/refunds', '{"invoice_id":"inv_1","amount":"0.5"}'];
        yield 'refunds retrieve' => [fn (Client $c) => $c->refunds->retrieve('rf_1'), 'GET', '/api/v1/refunds/rf_1', null];
        yield 'refunds list' => [fn (Client $c) => $c->refunds->list(['limit' => 1]), 'GET', '/api/v1/refunds?limit=1', null];
        yield 'refunds cancel' => [fn (Client $c) => $c->refunds->cancel('rf_1'), 'POST', '/api/v1/refunds/rf_1/cancel', '{}'];
        yield 'payouts create' => [fn (Client $c) => $c->payouts->create(self::PAYOUT), 'POST', '/api/v1/payouts', json_encode(self::PAYOUT)];
        yield 'payouts create batch' => [fn (Client $c) => $c->payouts->createBatch(['payouts' => [self::PAYOUT, self::PAYOUT]]), 'POST', '/api/v1/payouts/batch', json_encode(['payouts' => [self::PAYOUT, self::PAYOUT]])];
        yield 'payouts retrieve' => [fn (Client $c) => $c->payouts->retrieve('po_1'), 'GET', '/api/v1/payouts/po_1', null];
        yield 'payouts list' => [fn (Client $c) => $c->payouts->list(), 'GET', '/api/v1/payouts', null];
        yield 'payouts cancel' => [fn (Client $c) => $c->payouts->cancel('po_1'), 'POST', '/api/v1/payouts/po_1/cancel', '{}'];
        yield 'subscriptions create' => [fn (Client $c) => $c->subscriptions->create(['customer_email' => 'a@example.com', 'amount' => '5.00', 'currency' => 'USD', 'interval' => 'month']), 'POST', '/api/v1/subscriptions', '{"customer_email":"a@example.com","amount":"5.00","currency":"USD","interval":"month"}'];
        yield 'subscriptions list' => [fn (Client $c) => $c->subscriptions->list(['limit' => 3]), 'GET', '/api/v1/subscriptions?limit=3', null];
        yield 'subscriptions cancel' => [fn (Client $c) => $c->subscriptions->cancel('sub_1'), 'DELETE', '/api/v1/subscriptions/sub_1', null];
        yield 'credits topup' => [fn (Client $c) => $c->credits->topup(['amount' => '10', 'currency' => 'USD']), 'POST', '/api/v1/credits/topup', '{"amount":"10","currency":"USD"}'];
        yield 'credits charge' => [fn (Client $c) => $c->credits->charge(['token' => 'tok', 'amount' => '1']), 'POST', '/api/v1/credits/charge', '{"token":"tok","amount":"1"}'];
        yield 'credits refund charge' => [fn (Client $c) => $c->credits->refundCharge('ch_1'), 'POST', '/api/v1/credits/charges/ch_1/refund', '{}'];
        yield 'tokens list' => [fn (Client $c) => $c->tokens->list(), 'GET', '/api/v1/tokens', null];
        yield 'webhooks send test' => [fn (Client $c) => $c->webhooks->sendTest(), 'POST', '/api/v1/webhooks/test', null];
    }

    /** @param \Closure(Client): mixed $call */
    #[DataProvider('calls')]
    public function testResourceMethodSendsItsMethodPathAndBody(\Closure $call, string $method, string $path, ?string $body): void
    {
        $call(self::client());
        $sent = self::onlyRequest();
        self::assertSame([$method, $path], [$sent['method'], $sent['path']]);
        self::assertSame($body ?? '', $sent['body']);
        self::assertSame('POST' === $method, isset($sent['headers']['idempotency-key']));
    }

    public function testIdempotencyKeyOptionIsSentByEveryPostMethodThatTakesOne(): void
    {
        $client = self::client();
        $options = ['idempotency_key' => 'key-1'];
        $client->invoices->create(['amount' => '1.00', 'currency' => 'USD'], $options);
        $client->invoices->redeem('inv_1', $options);
        $client->paymentLinks->create(['title' => 'Tip', 'currency' => 'USD'], $options);
        $client->refunds->create(['invoice_id' => 'inv_1'], $options);
        $client->refunds->cancel('rf_1', $options);
        $client->payouts->create(self::PAYOUT, $options);
        $client->payouts->createBatch(['payouts' => [self::PAYOUT]], $options);
        $client->payouts->cancel('po_1', $options);
        $client->subscriptions->create(['customer_email' => 'a@example.com', 'amount' => '5.00', 'currency' => 'USD', 'interval' => 'week'], $options);
        $client->credits->topup(['amount' => '10', 'currency' => 'USD'], $options);
        $client->credits->charge(['token' => 'tok', 'amount' => '1'], $options);
        $client->credits->refundCharge('ch_1', $options);
        $keys = array_map(static fn (array $r): string => $r['headers']['idempotency-key'], self::$server->requests());
        self::assertSame(array_fill(0, 12, 'key-1'), $keys);
    }

    public function testIdsThatClimbOutOfTheirPathAreRefusedBeforeAnyRequest(): void
    {
        $client = self::client();
        $calls = [
            fn () => $client->invoices->retrieve('..'),
            fn () => $client->invoices->redeem('.'),
            fn () => $client->refunds->cancel(''),
            fn () => $client->payouts->retrieve('..'),
            fn () => $client->paymentLinks->deactivate('..'),
            fn () => $client->subscriptions->cancel('..'),
            fn () => $client->credits->refundCharge('..'),
        ];
        foreach ($calls as $call) {
            try {
                $call();
                self::fail('Expected InvalidArgumentException.');
            } catch (\InvalidArgumentException) {
                self::addToAssertionCount(1);
            }
        }
        self::assertSame([], self::$server->requests());
    }

    public function testListAllFollowsPagesWithTheLastId(): void
    {
        self::$server->reset(
            [200, ['object' => 'list', 'data' => [['id' => 'inv_3'], ['id' => 'inv_2']], 'has_more' => true]],
            [200, ['object' => 'list', 'data' => [['id' => 'inv_1']], 'has_more' => false]],
        );
        $ids = array_map(static fn (array $invoice): string => $invoice['id'], iterator_to_array(self::client()->invoices->listAll(['limit' => 2]), false));
        self::assertSame(['inv_3', 'inv_2', 'inv_1'], $ids);
        self::assertSame(
            ['/api/v1/invoices?limit=2', '/api/v1/invoices?limit=2&starting_after=inv_2'],
            array_map(static fn (array $r): string => $r['path'], self::$server->requests()),
        );
    }
}
