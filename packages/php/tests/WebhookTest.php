<?php

declare(strict_types=1);

namespace Solverr\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Solverr\Exception\WebhookVerificationException;
use Solverr\Webhook;

final class WebhookTest extends TestCase
{
    private string $secret;
    private string $body;

    protected function setUp(): void
    {
        $this->secret = self::newSecret();
        $this->body = json_encode(['id' => 'evt_1', 'type' => 'invoice.paid', 'data' => ['invoice' => ['id' => 'inv_1']]]);
    }

    private static function newSecret(int $bytes = 32): string
    {
        return 'whsec_' . base64_encode(random_bytes($bytes));
    }

    private static function sign(string $secret, string $id, string $timestamp, string $body): string
    {
        return base64_encode(hash_hmac('sha256', "{$id}.{$timestamp}.{$body}", base64_decode(substr($secret, 6), true), true));
    }

    /** @return array<string, string> */
    private function headers(?string $secret = null, ?int $timestamp = null, ?string $body = null, ?string $signature = null): array
    {
        $stamp = (string) ($timestamp ?? time());
        return [
            'webhook-id' => 'evt_1',
            'webhook-timestamp' => $stamp,
            'webhook-signature' => $signature ?? 'v1,' . self::sign($secret ?? $this->secret, 'evt_1', $stamp, $body ?? $this->body),
        ];
    }

    private function assertRefused(string $body, array $headers, ?string $secret = null, string $fragment = '', int $tolerance = 300): void
    {
        try {
            Webhook::verify($body, $headers, $secret ?? $this->secret, $tolerance);
            self::fail('Expected WebhookVerificationException.');
        } catch (WebhookVerificationException $error) {
            self::assertStringContainsString($fragment, $error->getMessage());
        }
    }

    public function testValidSignatureReturnsTheEvent(): void
    {
        self::assertSame('invoice.paid', Webhook::verify($this->body, $this->headers(), $this->secret)['type']);
    }

    public function testAnyHeaderCasingAndSingleValueListsVerify(): void
    {
        $signed = $this->headers();
        $headers = ['Webhook-Id' => [$signed['webhook-id']], 'WEBHOOK-TIMESTAMP' => $signed['webhook-timestamp'], 'Webhook-Signature' => [$signed['webhook-signature']]];
        self::assertSame('evt_1', Webhook::verify($this->body, $headers, $this->secret)['id']);
    }

    public function testTamperedBodyIsRefused(): void
    {
        $this->assertRefused(str_replace('inv_1', 'inv_2', $this->body), $this->headers(), fragment: 'does not match');
    }

    public function testSignatureFromAnotherSecretIsRefused(): void
    {
        $this->assertRefused($this->body, $this->headers(secret: self::newSecret()), fragment: 'does not match');
    }

    public function testTamperedMessageIdIsRefused(): void
    {
        $this->assertRefused($this->body, ['webhook-id' => 'evt_2'] + $this->headers(), fragment: 'does not match');
    }

    public function testTimestampsOutsideTheToleranceAreRefusedBothWays(): void
    {
        $this->assertRefused($this->body, $this->headers(timestamp: time() - 400), fragment: '300 seconds');
        $this->assertRefused($this->body, $this->headers(timestamp: time() + 400), fragment: '300 seconds');
    }

    public function testTimestampsInsideTheToleranceVerify(): void
    {
        self::assertSame('evt_1', Webhook::verify($this->body, $this->headers(timestamp: time() - 290), $this->secret)['id']);
        self::assertSame('evt_1', Webhook::verify($this->body, $this->headers(timestamp: time() + 290), $this->secret)['id']);
    }

    public function testCustomToleranceAppliesAndMustNotBeNegative(): void
    {
        $old = $this->headers(timestamp: time() - 60);
        $this->assertRefused($this->body, $old, tolerance: 30);
        self::assertSame('evt_1', Webhook::verify($this->body, $old, $this->secret, 120)['id']);
        $this->assertRefused($this->body, $this->headers(), fragment: 'tolerance', tolerance: -1);
    }

    public function testRotationHeaderVerifiesWhenAnyV1EntryMatches(): void
    {
        $current = $this->headers()['webhook-signature'];
        $stale = 'v1,' . self::sign(self::newSecret(), 'evt_1', (string) time(), $this->body);
        self::assertSame('evt_1', Webhook::verify($this->body, $this->headers(signature: "{$stale} {$current}"), $this->secret)['id']);
    }

    public function testSignaturesOfAnotherVersionAreIgnored(): void
    {
        $signature = str_replace('v1,', 'v2,', $this->headers()['webhook-signature']);
        $this->assertRefused($this->body, $this->headers(signature: $signature), fragment: 'does not match');
    }

    public function testUnpaddedUrlSafeAndNonCanonicalSignaturesAreRefused(): void
    {
        $good = substr($this->headers()['webhook-signature'], 3);
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        $spellings = [
            rtrim($good, '='),
            strtr($good, '+/', '-_'),
            substr($good, 0, 42) . $alphabet[strpos($alphabet, $good[42]) ^ 1] . substr($good, 43),
        ];
        foreach (array_unique($spellings) as $spelling) {
            if ($spelling !== $good) {
                $this->assertRefused($this->body, $this->headers(signature: "v1,{$spelling}"), fragment: 'does not match');
            }
        }
    }

    /** @return iterable<string, array{\Closure(string): string}> Each case builds a bad secret from the standard base64 of 32 random bytes. */
    public static function badSecrets(): iterable
    {
        yield 'missing prefix' => [fn (string $b64): string => $b64];
        yield 'url-safe alphabet' => [fn (string $b64): string => 'whsec_' . strtr($b64, '+/', '-_')];
        yield 'too short' => [fn (string $b64): string => 'whsec_' . base64_encode(random_bytes(16))];
        yield 'whitespace inside' => [fn (string $b64): string => 'whsec_' . substr($b64, 0, 20) . ' ' . substr($b64, 20)];
        yield 'empty' => [fn (string $b64): string => 'whsec_'];
    }

    /** @param \Closure(string): string $build */
    #[DataProvider('badSecrets')]
    public function testBadSecretsAreRefused(\Closure $build): void
    {
        do {
            $b64 = base64_encode(random_bytes(32));
        } while (strpbrk($b64, '+/') === false);
        $this->assertRefused($this->body, $this->headers(), $build($b64));
    }

    public function testUnpaddedSecretVerifies(): void
    {
        self::assertSame('evt_1', Webhook::verify($this->body, $this->headers(), rtrim($this->secret, '='))['id']);
    }

    public function testMissingHeadersAreRefused(): void
    {
        foreach (['webhook-id', 'webhook-timestamp', 'webhook-signature'] as $name) {
            $headers = $this->headers();
            unset($headers[$name]);
            $this->assertRefused($this->body, $headers, fragment: 'missing');
        }
    }

    public function testHeaderListsWithTwoValuesAreRefused(): void
    {
        $headers = $this->headers();
        $headers['webhook-signature'] = [$headers['webhook-signature'], $headers['webhook-signature']];
        $this->assertRefused($this->body, $headers, fragment: 'missing');
    }

    public function testNonNumericTimestampIsRefused(): void
    {
        $this->assertRefused($this->body, ['webhook-timestamp' => '1e9'] + $this->headers(), fragment: 'unix time');
    }

    public function testSignedBodyThatIsNotAJsonObjectIsRefused(): void
    {
        $this->assertRefused('[1,2]', $this->headers(body: '[1,2]'), fragment: 'not a JSON object');
        $this->assertRefused('{oops', $this->headers(body: '{oops'), fragment: 'not valid JSON');
    }
}
