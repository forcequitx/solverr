<?php

declare(strict_types=1);

namespace Solverr\Tests;

use PHPUnit\Framework\TestCase;
use Solverr\Tests\Support\LocalServer;

/** Shares one local server per test class and clears its script and request log before each test. */
abstract class ServerTestCase extends TestCase
{
    /** Built in two parts so secret scanners do not read a fake key as a real one. */
    protected const API_KEY = 'sk_live_' . 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

    protected static LocalServer $server;

    public static function setUpBeforeClass(): void
    {
        self::$server = LocalServer::start();
    }

    public static function tearDownAfterClass(): void
    {
        self::$server->stop();
    }

    protected function setUp(): void
    {
        self::$server->reset();
    }

    /** @return array{method: string, path: string, headers: array<string, string>, body: string} The only request the server received. */
    protected static function onlyRequest(): array
    {
        $requests = self::$server->requests();
        self::assertCount(1, $requests);
        return $requests[0];
    }

    protected static function errorBody(string $type, string $message = 'Refused.', array $extra = []): array
    {
        return ['error' => ['type' => $type, 'message' => $message] + $extra];
    }
}
