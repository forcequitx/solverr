<?php

declare(strict_types=1);

namespace Solverr\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use Solverr\Client;
use Solverr\Config;

final class ClientTest extends ServerTestCase
{
    protected function tearDown(): void
    {
        putenv(Config::BASE_URL_ENV);
    }

    /** @return iterable<string, array{mixed}> */
    public static function badApiKeys(): iterable
    {
        yield 'missing' => [null];
        yield 'empty' => [''];
        yield 'test key' => ['sk_test_abc'];
        yield 'publishable key' => ['pk_live_abc'];
        yield 'prefix only' => ['sk_live_'];
        yield 'space inside' => ['sk_live_a b'];
        yield 'trailing newline' => ["sk_live_abc\n"];
        yield 'non-ASCII character' => ['sk_live_abcé'];
        yield 'not a string' => [123];
    }

    #[DataProvider('badApiKeys')]
    public function testOnlyLiveApiKeysAreAccepted(mixed $key): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('sk_live_');
        new Client(['api_key' => $key, 'base_url' => 'https://pay.example.com']);
    }

    /** @return iterable<string, array{string}> */
    public static function goodBaseUrls(): iterable
    {
        yield 'https' => ['https://pay.example.com'];
        yield 'https with path' => ['https://example.com/solverr/'];
        yield 'http localhost' => ['http://localhost:3000'];
        yield 'http loopback' => ['http://127.0.0.1:3000'];
        yield 'http ipv6 loopback' => ['http://[::1]:3000'];
        yield 'upper-case scheme' => ['HTTPS://pay.example.com'];
    }

    #[DataProvider('goodBaseUrls')]
    public function testHttpsAndLocalHttpBaseUrlsAreAccepted(string $url): void
    {
        self::assertInstanceOf(Client::class, new Client(['api_key' => self::API_KEY, 'base_url' => $url]));
    }

    /** @return iterable<string, array{string}> */
    public static function badBaseUrls(): iterable
    {
        yield 'plain http' => ['http://pay.example.com'];
        yield 'other scheme' => ['ftp://pay.example.com'];
        yield 'no scheme' => ['pay.example.com'];
        yield 'query' => ['https://pay.example.com/?a=1'];
        yield 'fragment' => ['https://pay.example.com/#x'];
        yield 'space in the path' => ['https://pay.example.com/my app'];
        yield 'line break' => ["https://pay.example.com\n"];
    }

    #[DataProvider('badBaseUrls')]
    public function testOtherBaseUrlsAreRefused(string $url): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new Client(['api_key' => self::API_KEY, 'base_url' => $url]);
    }

    public function testTrailingSlashIsDroppedFromTheBaseUrl(): void
    {
        (new Client(['api_key' => self::API_KEY, 'base_url' => self::$server->baseUrl . '/']))->invoices->retrieve('inv_1');
        self::assertSame('/api/v1/invoices/inv_1', self::onlyRequest()['path']);
    }

    public function testBaseUrlFromGetenvFalseFallsBackToSolverrUrl(): void
    {
        putenv(Config::BASE_URL_ENV . '=' . self::$server->baseUrl);
        $client = new Client(['api_key' => self::API_KEY, 'base_url' => getenv('SOLVERR_URL_THAT_IS_NOT_SET')]);
        $client->invoices->retrieve('inv_1');
        self::assertSame('/api/v1/invoices/inv_1', self::onlyRequest()['path']);
    }

    public function testMissingBaseUrlAndSolverrUrlGiveAClearError(): void
    {
        putenv(Config::BASE_URL_ENV);
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Pass base_url to new Solverr\Client() or set the SOLVERR_URL environment variable.');
        new Client(['api_key' => self::API_KEY, 'base_url' => getenv('SOLVERR_URL_THAT_IS_NOT_SET')]);
    }
}
