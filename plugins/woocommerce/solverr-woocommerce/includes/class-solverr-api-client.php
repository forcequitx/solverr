<?php
/** HTTP client for the Solverr REST API.
    @package Solverr\WooCommerce */

defined( 'ABSPATH' ) || exit;

/** Error returned by the Solverr API or raised by the transport. */
class Solverr_API_Exception extends Exception {

	/** `$message` carries no secrets; `$status` is the HTTP status (0 without a response); `$error_type` the Solverr error type, such as `invalid_request`;
	    `$retry_after` the Retry-After seconds (0 without one); `$param` the request field the error is about, such as `customer_email`, or empty. */
	public function __construct( string $message, public readonly int $status = 0, public readonly string $error_type = '', public readonly int $retry_after = 0, public readonly string $param = '' ) {
		parent::__construct( $message );
	}
}

/** Calls the Solverr API with a merchant API key. */
class Solverr_API_Client {

	private const TIMEOUT_SECONDS         = 15;
	private const MAX_ATTEMPTS            = 2;
	private const RETRY_DELAY_US          = 500000;
	private const MAX_RETRY_AFTER_RETRIES = 3;
	/** Longest Retry-After the client waits for while the customer waits at checkout; a longer one fails the request. */
	private const MAX_RETRY_AFTER_SECONDS = 5;

	/** `$base_url` is the API base URL without a trailing slash; `$secret_key` is the merchant API key (`sk_live_…`). */
	public function __construct( private readonly string $base_url, #[\SensitiveParameter] private readonly string $secret_key ) {}

	/** @return array<string, mixed> The created invoice; the Idempotency-Key value makes a retried request return the same invoice.
	    @throws Solverr_API_Exception When the request fails. */
	public function create_invoice( array $params, string $idempotency_key ): array {
		return $this->request( 'POST', '/api/v1/invoices', $params, $idempotency_key );
	}

	/** @return array<string, mixed> The fetched invoice.
	    @throws Solverr_API_Exception When the request fails. */
	public function get_invoice( string $invoice_id ): array {
		return $this->request( 'GET', '/api/v1/invoices/' . rawurlencode( $invoice_id ) );
	}

	/** Sends a JSON request to `$path` below the base URL, retrying once after a network or server error; a rate limit or an in-progress
	    same-key request is retried after its Retry-After wait. Throws Solverr_API_Exception when the request fails. */
	private function request( string $method, string $path, ?array $body = null, ?string $idempotency_key = null ): array {
		$headers = array(
			'Authorization' => 'Bearer ' . $this->secret_key,
			'Accept'        => 'application/json',
			'User-Agent'    => 'Solverr-WooCommerce/' . SOLVERR_WC_VERSION,
		);
		if ( null !== $body ) {
			$headers['Content-Type'] = 'application/json';
		}
		if ( null !== $idempotency_key ) {
			$headers['Idempotency-Key'] = $idempotency_key;
		}

		$args = array(
			'method'      => $method,
			'timeout'     => self::TIMEOUT_SECONDS,
			'redirection' => 0,
			'headers'     => $headers,
			'body'        => null === $body ? null : wp_json_encode( $body ),
		);

		$attempt             = 1;
		$retry_after_retries = 0;
		while ( true ) {
			try {
				return $this->send( $this->base_url . $path, $args );
			} catch ( Solverr_API_Exception $error ) {
				if ( self::waits_for_retry_after( $error ) && $retry_after_retries < self::MAX_RETRY_AFTER_RETRIES ) {
					++$retry_after_retries;
					sleep( $error->retry_after );
					continue;
				}
				$retryable = 0 === $error->status || $error->status >= 500;
				if ( ! $retryable || $attempt >= self::MAX_ATTEMPTS ) {
					throw $error;
				}
				++$attempt;
				usleep( self::RETRY_DELAY_US );
			}
		}
	}

	/** Whether the error is a rate limit, or a request with the same key still being processed, with a short enough Retry-After. */
	private static function waits_for_retry_after( Solverr_API_Exception $error ): bool {
		$retryable = 429 === $error->status || ( 409 === $error->status && 'idempotency_conflict' === $error->error_type );
		return $retryable && $error->retry_after > 0 && $error->retry_after <= self::MAX_RETRY_AFTER_SECONDS;
	}

	/** @return array<string, mixed> Decoded JSON response of one request to the full `$url` with wp_remote_request() `$args`.
	    @throws Solverr_API_Exception When the request fails or the response is not a success. */
	private function send( string $url, array $args ): array {
		$response = wp_remote_request( $url, $args );
		if ( is_wp_error( $response ) ) {
			throw new Solverr_API_Exception( 'Solverr could not be reached: ' . $response->get_error_message() );
		}

		$status  = (int) wp_remote_retrieve_response_code( $response );
		$decoded = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( $status >= 200 && $status < 300 && is_array( $decoded ) ) {
			return $decoded;
		}

		$error       = is_array( $decoded ) && is_array( $decoded['error'] ?? null ) ? $decoded['error'] : array();
		$message     = is_string( $error['message'] ?? null ) ? $error['message'] : 'Unexpected response from Solverr.';
		$type        = is_string( $error['type'] ?? null ) ? $error['type'] : '';
		$param       = is_string( $error['param'] ?? null ) ? $error['param'] : '';
		$retry_after = wp_remote_retrieve_header( $response, 'retry-after' );
		$retry_after = is_string( $retry_after ) && ctype_digit( $retry_after ) ? (int) $retry_after : 0;
		throw new Solverr_API_Exception( sprintf( 'Solverr API returned HTTP %d: %s', $status, mb_substr( $message, 0, 300 ) ), $status, $type, $retry_after, $param );
	}
}
