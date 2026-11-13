<?php
/** Unit tests for Solverr_API_Client with the WordPress HTTP API replaying queued responses.
    Retries really wait (0.5 s after a network or server error, Retry-After seconds otherwise), so some tests take a few seconds.
    @package Solverr\WooCommerce\Tests */

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ApiClientTest extends TestCase {

	private const BASE_URL   = 'https://pay.example.com';
	/** Built in two parts so secret scanners do not read a fake key as a real one. */
	private const SECRET_KEY = 'sk_live_' . 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

	protected function setUp(): void {
		$GLOBALS['solverr_test_requests']  = array();
		$GLOBALS['solverr_test_responses'] = array();
	}

	protected function tearDown(): void {
		unset( $GLOBALS['solverr_test_requests'], $GLOBALS['solverr_test_responses'] );
	}

	/** @param array<string, string> $headers */
	private static function response( int $code, mixed $body, array $headers = array() ): array {
		return array(
			'headers'  => $headers,
			'body'     => is_string( $body ) ? $body : (string) json_encode( $body ),
			'response' => array( 'code' => $code, 'message' => '' ),
		);
	}

	/** A Solverr error response; `$param` is left out of the body when empty, as the API does. */
	private static function api_error( int $code, string $type, string $message, string $param = '', array $headers = array() ): array {
		$error = array( 'type' => $type, 'message' => $message ) + ( '' === $param ? array() : array( 'param' => $param ) );
		return self::response( $code, array( 'error' => $error ), $headers );
	}

	private static function queue( array|WP_Error ...$responses ): void {
		$GLOBALS['solverr_test_responses'] = $responses;
	}

	/** @return list<array{string, array<string, mixed>}> Each request as `[url, args]`, in the order sent. */
	private static function requests(): array {
		return $GLOBALS['solverr_test_requests'];
	}

	private static function client(): Solverr_API_Client {
		return new Solverr_API_Client( self::BASE_URL, self::SECRET_KEY );
	}

	private static function thrown( callable $call ): Solverr_API_Exception {
		try {
			$call();
		} catch ( Solverr_API_Exception $error ) {
			return $error;
		}
		self::fail( 'No Solverr_API_Exception was thrown.' );
	}

	public function test_create_invoice_posts_json_with_the_idempotency_key_and_returns_the_invoice(): void {
		self::queue( self::response( 201, array( 'id' => 'inv_1', 'status' => 'created' ) ) );

		$invoice = self::client()->create_invoice( array( 'amount' => '25.00', 'currency' => 'USD' ), 'wc-order-7' );

		self::assertSame( array( 'id' => 'inv_1', 'status' => 'created' ), $invoice );
		self::assertSame(
			array(
				array(
					'https://pay.example.com/api/v1/invoices',
					array(
						'method'      => 'POST',
						'timeout'     => 15,
						'redirection' => 0,
						'headers'     => array(
							'Authorization'   => 'Bearer ' . self::SECRET_KEY,
							'Accept'          => 'application/json',
							'User-Agent'      => 'Solverr-WooCommerce/0.0.0-test',
							'Content-Type'    => 'application/json',
							'Idempotency-Key' => 'wc-order-7',
						),
						'body'        => '{"amount":"25.00","currency":"USD"}',
					),
				),
			),
			self::requests()
		);
	}

	public function test_get_invoice_encodes_the_id_in_the_path_and_sends_no_body(): void {
		self::queue( self::response( 200, array( 'id' => 'inv/1 ?' ) ) );

		self::assertSame( array( 'id' => 'inv/1 ?' ), self::client()->get_invoice( 'inv/1 ?' ) );
		self::assertSame(
			array(
				array(
					'https://pay.example.com/api/v1/invoices/inv%2F1%20%3F',
					array(
						'method'      => 'GET',
						'timeout'     => 15,
						'redirection' => 0,
						'headers'     => array(
							'Authorization' => 'Bearer ' . self::SECRET_KEY,
							'Accept'        => 'application/json',
							'User-Agent'    => 'Solverr-WooCommerce/0.0.0-test',
						),
						'body'        => null,
					),
				),
			),
			self::requests()
		);
	}

	public function test_network_error_is_retried_once_with_the_same_request(): void {
		self::queue( new WP_Error( 'http_request_failed', 'cURL error 28: Operation timed out' ), self::response( 201, array( 'id' => 'inv_1' ) ) );

		self::assertSame( array( 'id' => 'inv_1' ), self::client()->create_invoice( array( 'amount' => '25.00' ), 'wc-order-7' ) );
		$requests = self::requests();
		self::assertCount( 2, $requests );
		self::assertSame( $requests[0], $requests[1] );
		self::assertSame( 'wc-order-7', $requests[1][1]['headers']['Idempotency-Key'] );
	}

	public function test_second_network_error_is_thrown_with_status_zero(): void {
		self::queue( new WP_Error( 'http_request_failed', 'timed out' ), new WP_Error( 'http_request_failed', 'cURL error 6: Could not resolve host' ) );

		$error = self::thrown( fn () => self::client()->get_invoice( 'inv_1' ) );

		self::assertSame( 'Solverr could not be reached: cURL error 6: Could not resolve host', $error->getMessage() );
		self::assertSame( array( 0, '', 0, '' ), array( $error->status, $error->error_type, $error->retry_after, $error->param ) );
		self::assertCount( 2, self::requests() );
	}

	public function test_server_error_is_retried_once_then_thrown(): void {
		self::queue( self::response( 500, '<html>Internal Server Error</html>' ), self::api_error( 503, 'upstream_unavailable', 'NEAR Intents is not reachable.' ) );

		$error = self::thrown( fn () => self::client()->get_invoice( 'inv_1' ) );

		self::assertSame( 'Solverr API returned HTTP 503: NEAR Intents is not reachable.', $error->getMessage() );
		self::assertSame( array( 503, 'upstream_unavailable' ), array( $error->status, $error->error_type ) );
		self::assertCount( 2, self::requests() );
	}

	public function test_server_error_then_success_returns_the_second_response(): void {
		self::queue( self::response( 502, '' ), self::response( 200, array( 'id' => 'inv_1' ) ) );

		self::assertSame( array( 'id' => 'inv_1' ), self::client()->get_invoice( 'inv_1' ) );
		self::assertCount( 2, self::requests() );
	}

	/** @return iterable<string, array{array<string, mixed>, int, string, int, string}> Response, then the error's status, type, Retry-After and param. */
	public static function final_errors(): iterable {
		yield 'invalid request' => array( self::api_error( 400, 'invalid_request', 'amount must be a decimal string.', 'amount' ), 400, 'invalid_request', 0, 'amount' );
		yield 'bad key' => array( self::api_error( 401, 'authentication_failed', 'Invalid API key.' ), 401, 'authentication_failed', 0, '' );
		yield 'not found' => array( self::api_error( 404, 'not_found', 'No such invoice.' ), 404, 'not_found', 0, '' );
		yield 'key used with another request' => array( self::api_error( 409, 'idempotency_conflict', 'This Idempotency-Key was already used with a different request.', 'Idempotency-Key' ), 409, 'idempotency_conflict', 0, 'Idempotency-Key' );
		yield 'other conflict with Retry-After' => array( self::api_error( 409, 'invalid_state', 'The invoice is busy.', '', array( 'Retry-After' => '1' ) ), 409, 'invalid_state', 1, '' );
		yield 'rate limit without Retry-After' => array( self::api_error( 429, 'rate_limited', 'Too many requests.' ), 429, 'rate_limited', 0, '' );
		yield 'rate limit with Retry-After over 5 seconds' => array( self::api_error( 429, 'rate_limited', 'Too many requests.', '', array( 'Retry-After' => '6' ) ), 429, 'rate_limited', 6, '' );
		yield 'in-progress key with Retry-After over 5 seconds' => array( self::api_error( 409, 'idempotency_conflict', 'Still being processed.', 'Idempotency-Key', array( 'Retry-After' => '30' ) ), 409, 'idempotency_conflict', 30, 'Idempotency-Key' );
		yield 'Retry-After as a date' => array( self::api_error( 429, 'rate_limited', 'Too many requests.', '', array( 'Retry-After' => 'Wed, 11 Nov 2026 12:00:00 GMT' ) ), 429, 'rate_limited', 0, '' );
		yield 'fractional Retry-After' => array( self::api_error( 429, 'rate_limited', 'Too many requests.', '', array( 'retry-after' => '1.5' ) ), 429, 'rate_limited', 0, '' );
	}

	/** @param array<string, mixed> $response */
	#[DataProvider( 'final_errors' )]
	public function test_client_errors_are_thrown_without_a_retry( array $response, int $status, string $type, int $retry_after, string $param ): void {
		self::queue( $response );

		$error = self::thrown( fn () => self::client()->create_invoice( array(), 'wc-order-7' ) );

		self::assertSame( array( $status, $type, $retry_after, $param ), array( $error->status, $error->error_type, $error->retry_after, $error->param ) );
		self::assertCount( 1, self::requests() );
	}

	/** @return iterable<string, array{array<string, mixed>}> */
	public static function short_waits(): iterable {
		yield 'rate limit' => array( self::api_error( 429, 'rate_limited', 'Too many requests.', '', array( 'Retry-After' => '1' ) ) );
		yield 'same key still being processed' => array( self::api_error( 409, 'idempotency_conflict', 'Still being processed.', 'Idempotency-Key', array( 'Retry-After' => '1' ) ) );
	}

	/** @param array<string, mixed> $response */
	#[DataProvider( 'short_waits' )]
	public function test_short_retry_after_is_waited_for_then_retried( array $response ): void {
		self::queue( $response, self::response( 201, array( 'id' => 'inv_1' ) ) );

		/** hrtime() is monotonic; Docker Desktop on Windows steps the wall clock that microtime() reads. */
		$started = hrtime( true );
		self::assertSame( array( 'id' => 'inv_1' ), self::client()->create_invoice( array(), 'wc-order-7' ) );

		self::assertGreaterThanOrEqual( 1.0, ( hrtime( true ) - $started ) / 1e9 );
		self::assertCount( 2, self::requests() );
	}

	public function test_retry_after_waits_stop_after_three(): void {
		$limited = self::api_error( 429, 'rate_limited', 'Too many requests.', '', array( 'Retry-After' => '1' ) );
		self::queue( $limited, $limited, $limited, $limited );

		$error = self::thrown( fn () => self::client()->get_invoice( 'inv_1' ) );

		self::assertSame( array( 429, 1 ), array( $error->status, $error->retry_after ) );
		self::assertCount( 4, self::requests() );
	}

	public function test_retry_after_wait_does_not_reset_the_single_server_error_retry(): void {
		self::queue(
			self::response( 500, '' ),
			self::api_error( 429, 'rate_limited', 'Too many requests.', '', array( 'Retry-After' => '1' ) ),
			self::response( 500, '' )
		);

		$error = self::thrown( fn () => self::client()->get_invoice( 'inv_1' ) );

		self::assertSame( 500, $error->status );
		self::assertCount( 3, self::requests() );
	}

	/** @return iterable<string, array{string}> */
	public static function non_object_bodies(): iterable {
		yield 'not JSON' => array( 'OK' );
		yield 'JSON string' => array( '"inv_1"' );
		yield 'empty' => array( '' );
	}

	#[DataProvider( 'non_object_bodies' )]
	public function test_success_status_without_a_json_object_is_an_error_and_not_retried( string $body ): void {
		self::queue( self::response( 200, $body ) );

		$error = self::thrown( fn () => self::client()->get_invoice( 'inv_1' ) );

		self::assertSame( 'Solverr API returned HTTP 200: Unexpected response from Solverr.', $error->getMessage() );
		self::assertSame( 200, $error->status );
		self::assertCount( 1, self::requests() );
	}

	public function test_error_message_is_cut_to_300_characters(): void {
		self::queue( self::api_error( 400, 'invalid_request', str_repeat( 'é', 400 ) ) );

		$error = self::thrown( fn () => self::client()->get_invoice( 'inv_1' ) );

		self::assertSame( 'Solverr API returned HTTP 400: ' . str_repeat( 'é', 300 ), $error->getMessage() );
	}
}
