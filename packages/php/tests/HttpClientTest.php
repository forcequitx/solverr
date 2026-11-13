<?php

declare(strict_types=1);

namespace Solverr\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use Solverr\Config;
use Solverr\Exception\ApiException;
use Solverr\HttpClient;
use Solverr\Tests\Support\LocalServer;

final class HttpClientTest extends ServerTestCase
{
    private function http(?string $baseUrl = null): HttpClient
    {
        return new HttpClient(self::API_KEY, $baseUrl ?? self::$server->baseUrl);
    }

    private function catchApiException(callable $call): ApiException
    {
        try {
            $call();
        } catch (ApiException $error) {
            return $error;
        }
        self::fail('Expected an ApiException.');
    }

    public function testGetSendsBearerKeyAcceptAndUserAgentWithoutIdempotencyKey(): void
    {
        self::$server->reset([200, ['id' => 'inv_1']]);
        self::assertSame(['id' => 'inv_1'], $this->http()->request('GET', '/api/v1/invoices/inv_1'));
        $sent = self::onlyRequest();
        self::assertSame('GET', $sent['method']);
        self::assertSame('Bearer ' . self::API_KEY, $sent['headers']['authorization']);
        self::assertSame('application/json', $sent['headers']['accept']);
        self::assertSame('solverr-php/' . Config::SDK_VERSION, $sent['headers']['user-agent']);
        self::assertArrayNotHasKey('idempotency-key', $sent['headers']);
    }

    public function testPostGetsARandomUuid4IdempotencyKeyPerCall(): void
    {
        $this->http()->request('POST', '/a', body: []);
        $this->http()->request('POST', '/a', body: []);
        [$first, $second] = array_map(static fn (array $r): string => $r['headers']['idempotency-key'], self::$server->requests());
        self::assertMatchesRegularExpression('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D', $first);
        self::assertNotSame($first, $second);
    }

    public function testPostBodyLeavesOutNullFieldsAndEncodesAnEmptyBodyAsAnObject(): void
    {
        $this->http()->request('POST', '/a', body: ['amount' => '1.00', 'description' => null, 'title' => 'Café/1']);
        $this->http()->request('POST', '/a', body: ['description' => null]);
        [$full, $empty] = self::$server->requests();
        self::assertSame('application/json', $full['headers']['content-type']);
        self::assertSame('{"amount":"1.00","title":"Café/1"}', $full['body']);
        self::assertSame('{}', $empty['body']);
    }

    public function testPostWithoutBodySendsNoContentType(): void
    {
        $this->http()->request('POST', '/a');
        $sent = self::onlyRequest();
        self::assertSame('', $sent['body']);
        self::assertArrayNotHasKey('content-type', $sent['headers']);
        self::assertArrayHasKey('idempotency-key', $sent['headers']);
    }

    public function testQueryLeavesOutNullAndPercentEncodesSpaces(): void
    {
        $this->http()->request('GET', '/a', ['limit' => 5, 'starting_after' => null, 'status' => 'a b&c']);
        self::assertSame('/a?limit=5&status=a%20b%26c', self::onlyRequest()['path']);
    }

    /** @return iterable<string, array{string}> */
    public static function badIdempotencyKeys(): iterable
    {
        yield 'empty' => [''];
        yield 'line break' => ["key\r\nX-Injected: 1"];
        yield 'nul' => ["key\0"];
    }

    #[DataProvider('badIdempotencyKeys')]
    public function testIdempotencyKeysThatCurlWouldMangleAreRefusedBeforeSending(string $key): void
    {
        try {
            $this->http()->request('POST', '/a', body: [], idempotencyKey: $key);
            self::fail('Expected InvalidArgumentException.');
        } catch (\InvalidArgumentException) {
            self::assertSame([], self::$server->requests());
        }
    }

    public function testPathSegmentEncodesSlashesAndRefusesDotSegments(): void
    {
        self::assertSame('inv%2F..%2Fx', HttpClient::pathSegment('inv/../x'));
        self::assertSame('%C3%BC%3F%23', HttpClient::pathSegment('ü?#'));
        foreach (['', '.', '..'] as $id) {
            try {
                HttpClient::pathSegment($id);
                self::fail("Expected {$id} to be refused.");
            } catch (\InvalidArgumentException) {
                self::addToAssertionCount(1);
            }
        }
    }

    public function test5xxIsRetriedTwiceWithTheSameIdempotencyKeyAndGrowingBackoff(): void
    {
        self::$server->reset([500, 'oops'], [503, 'oops'], [200, ['ok' => true]]);
        self::assertSame(['ok' => true], $this->http()->request('POST', '/a', body: []));
        $requests = self::$server->requests();
        self::assertCount(3, $requests);
        self::assertCount(1, array_unique(array_map(static fn (array $r): string => $r['headers']['idempotency-key'], $requests)));
        /** Waits are measured between arrivals at the server on the monotonic clock, so a busy machine or a clock correction barely moves them;
            each stays below the next doubling. */
        $firstWait = $requests[1]['received_at'] - $requests[0]['received_at'];
        $secondWait = $requests[2]['received_at'] - $requests[1]['received_at'];
        self::assertGreaterThanOrEqual(0.5, $firstWait, 'waits 0.5 s with up to 25% jitter');
        self::assertLessThan(1.0, $firstWait);
        self::assertGreaterThanOrEqual(1.0, $secondWait, 'then 1 s with up to 25% jitter');
        self::assertLessThan(2.0, $secondWait);
    }

    public function testNetworkErrorsAfterTheLastRetryThrowConnectionErrorWithStatus0(): void
    {
        $error = $this->catchApiException(fn () => $this->http('http://127.0.0.1:' . LocalServer::freePort())->request('GET', '/a'));
        self::assertSame(0, $error->status);
        self::assertSame('connection_error', $error->type);
        self::assertStringStartsWith('Could not reach Solverr at http://127.0.0.1:', $error->getMessage());
    }

    public function testRetryAfterIsWaitedForOn429AndKeepsTheIdempotencyKey(): void
    {
        self::$server->reset([429, self::errorBody('rate_limited'), ['Retry-After' => '1']], [200, ['ok' => true]]);
        $started = hrtime(true);
        self::assertSame(['ok' => true], $this->http()->request('POST', '/a', body: []));
        self::assertGreaterThanOrEqual(1.0, (hrtime(true) - $started) / 1e9);
        $requests = self::$server->requests();
        self::assertCount(2, $requests);
        self::assertSame($requests[0]['headers']['idempotency-key'], $requests[1]['headers']['idempotency-key']);
    }

    public function testInProgress409IsRetriedAfterItsRetryAfter(): void
    {
        self::$server->reset([409, self::errorBody('idempotency_conflict'), ['Retry-After' => '0']], [200, ['ok' => true]]);
        self::assertSame(['ok' => true], $this->http()->request('POST', '/a', body: []));
        self::assertCount(2, self::$server->requests());
    }

    public function testRetryAfterWaitsStopAfterThreeRetries(): void
    {
        $limited = [429, self::errorBody('rate_limited'), ['Retry-After' => '0']];
        self::$server->reset($limited, $limited, $limited, $limited);
        $error = $this->catchApiException(fn () => $this->http()->request('GET', '/a'));
        self::assertSame(429, $error->status);
        self::assertCount(4, self::$server->requests());
    }

    public function testRetryAfterOver10SecondsThrowsAtOnceWithRetryAfter(): void
    {
        self::$server->reset([429, self::errorBody('rate_limited', 'Slow down.'), ['Retry-After' => '11']]);
        $error = $this->catchApiException(fn () => $this->http()->request('GET', '/a'));
        self::assertSame([429, 11, 'Slow down.'], [$error->status, $error->retryAfter, $error->getMessage()]);
        self::assertCount(1, self::$server->requests());
    }

    /** @return iterable<string, array{array<string, string>}> */
    public static function unusableRetryAfter(): iterable
    {
        yield 'missing' => [[]];
        yield 'http date' => [['Retry-After' => 'Wed, 21 Oct 2026 07:28:00 GMT']];
        yield 'negative' => [['Retry-After' => '-1']];
    }

    /** @param array<string, string> $headers */
    #[DataProvider('unusableRetryAfter')]
    public function test429WithoutAUsableRetryAfterIsNotRetried(array $headers): void
    {
        self::$server->reset([429, self::errorBody('rate_limited'), $headers]);
        $error = $this->catchApiException(fn () => $this->http()->request('GET', '/a'));
        self::assertNull($error->retryAfter);
        self::assertCount(1, self::$server->requests());
    }

    /** @return iterable<string, array{int, string}> */
    public static function otherClientErrors(): iterable
    {
        yield '400' => [400, 'invalid_request'];
        yield '401' => [401, 'authentication_error'];
        yield '404' => [404, 'not_found'];
        yield '409 invalid state' => [409, 'invalid_state'];
        yield '422' => [422, 'invalid_request'];
    }

    #[DataProvider('otherClientErrors')]
    public function testOther4xxAreNotRetriedEvenWithRetryAfter(int $status, string $type): void
    {
        self::$server->reset([$status, self::errorBody($type), ['Retry-After' => '0']]);
        $error = $this->catchApiException(fn () => $this->http()->request('POST', '/a', body: []));
        self::assertSame([$status, $type], [$error->status, $error->type]);
        self::assertCount(1, self::$server->requests());
    }

    public function testRedirectIsThrownAndNeverFollowed(): void
    {
        $target = self::$server->baseUrl . '/elsewhere';
        self::$server->reset([302, '', ['Location' => $target]]);
        $error = $this->catchApiException(fn () => $this->http()->request('GET', '/a'));
        self::assertSame([302, 'api_error'], [$error->status, $error->type]);
        self::assertStringContainsString($target, $error->getMessage());
        self::assertSame('/a', self::onlyRequest()['path']);
    }

    public function testApiErrorBodyAndRetryAfterFillEveryExceptionField(): void
    {
        $body = self::errorBody('invalid_state', 'Invoice is paid.', ['param' => 'invoice_id', 'code' => 'invoice_paid']);
        self::$server->reset([409, $body, ['Retry-After' => '30']]);
        $error = $this->catchApiException(fn () => $this->http()->request('POST', '/a', body: []));
        self::assertSame(
            [409, 'invalid_state', 'Invoice is paid.', 'invoice_id', 'invoice_paid', 30],
            [$error->status, $error->type, $error->getMessage(), $error->param, $error->errorCode, $error->retryAfter],
        );
    }

    public function testErrorFieldsOfTheWrongTypeAreDropped(): void
    {
        self::$server->reset([400, ['error' => ['type' => 'invalid_request', 'message' => 'Bad.', 'param' => 5, 'code' => ['x']]]]);
        $error = $this->catchApiException(fn () => $this->http()->request('GET', '/a'));
        self::assertNull($error->param);
        self::assertNull($error->errorCode);
    }

    public function testErrorWithoutAnApiBodyGetsAGenericMessage(): void
    {
        self::$server->reset([418, '<html>']);
        $error = $this->catchApiException(fn () => $this->http()->request('GET', '/a'));
        self::assertSame([418, 'api_error', 'Solverr returned HTTP 418.', null], [$error->status, $error->type, $error->getMessage(), $error->retryAfter]);
    }

    public function testSuccessThatIsNotJsonThrows(): void
    {
        self::$server->reset([200, '<html>']);
        $error = $this->catchApiException(fn () => $this->http()->request('GET', '/a'));
        self::assertSame([200, 'api_error'], [$error->status, $error->type]);
    }
}
