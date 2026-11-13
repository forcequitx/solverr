<?php
/** Unit tests for WC_Gateway_Solverr::process_payment(): when an order's invoice is reused, and how a new one is created.
    @package Solverr\WooCommerce\Tests */

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class InvoiceReuseTest extends TestCase {

	private const BASE_URL     = 'https://pay.example.com';
	private const ORDER_ID     = 7;
	private const OLD_INVOICE  = 'inv_old';
	private const NEW_INVOICE  = 'inv_new';
	private const START_NOTICE = 'The crypto payment could not start. Try again in a moment, or choose another payment method.';

	private WC_Order $order;

	protected function setUp(): void {
		$this->order                = new WC_Order( self::ORDER_ID, '25.00', 'USD' );
		$this->order->billing_email = 'buyer@example.com';

		$GLOBALS['solverr_test_orders']    = array( self::ORDER_ID => $this->order );
		$GLOBALS['solverr_test_bloginfo']  = array( 'name' => 'Beans &amp; Co' );
		$GLOBALS['solverr_test_requests']  = array();
		$GLOBALS['solverr_test_responses'] = array();
		$GLOBALS['solverr_test_notices']   = array();
	}

	protected function tearDown(): void {
		unset(
			$GLOBALS['solverr_test_orders'],
			$GLOBALS['solverr_test_bloginfo'],
			$GLOBALS['solverr_test_requests'],
			$GLOBALS['solverr_test_responses'],
			$GLOBALS['solverr_test_notices'],
			$GLOBALS['solverr_test_logger']
		);
	}

	/** A gateway with the saved settings the API client reads; the constructor's WordPress hooks are skipped. */
	private static function gateway(): WC_Gateway_Solverr {
		$gateway           = ( new ReflectionClass( WC_Gateway_Solverr::class ) )->newInstanceWithoutConstructor();
		$gateway->settings = array(
			'api_base_url' => self::BASE_URL,
			'secret_key'   => 'sk_live_' . str_repeat( 'x', 32 ),
		);
		return $gateway;
	}

	/** `expires_at` in the API's format, `$seconds` from now. */
	private static function expires_in( int $seconds ): string {
		return gmdate( 'Y-m-d\TH:i:s.000\Z', time() + $seconds );
	}

	/** @param array<string, mixed> $overrides An invoice response for the order total, waiting for payment for another hour. */
	private static function invoice( array $overrides = array() ): array {
		$id = $overrides['id'] ?? self::NEW_INVOICE;
		return $overrides + array(
			'id'           => $id,
			'object'       => 'invoice',
			'mode'         => 'live',
			'status'       => 'awaiting_payment',
			'amount'       => '25.00',
			'currency'     => 'USD',
			'checkout_url' => self::BASE_URL . '/pay/' . $id,
			'expires_at'   => self::expires_in( 3600 ),
		);
	}

	private static function response( int $code, array $body, array $headers = array() ): array {
		return array(
			'headers'  => $headers,
			'body'     => (string) json_encode( $body ),
			'response' => array( 'code' => $code, 'message' => '' ),
		);
	}

	private static function api_error( int $code, string $type, string $message, string $param = '', array $headers = array() ): array {
		$error = array( 'type' => $type, 'message' => $message ) + ( '' === $param ? array() : array( 'param' => $param ) );
		return self::response( $code, array( 'error' => $error ), $headers );
	}

	private static function queue( array ...$responses ): void {
		$GLOBALS['solverr_test_responses'] = $responses;
	}

	/** @return list<array{string, array<string, mixed>}> */
	private static function requests(): array {
		return $GLOBALS['solverr_test_requests'];
	}

	/** @return list<string> The Idempotency-Key of each invoice creation request, in the order sent. */
	private static function creation_keys(): array {
		$keys = array();
		foreach ( array_column( self::requests(), 1 ) as $args ) {
			if ( 'POST' === $args['method'] ) {
				$keys[] = $args['headers']['Idempotency-Key'];
			}
		}
		return $keys;
	}

	/** @return array<string, mixed> Decoded body of request number `$index`. */
	private static function body( int $index ): array {
		return json_decode( self::requests()[ $index ][1]['body'], true );
	}

	/** The order has paid for, or is paying, `inv_old`. */
	private function with_old_invoice(): void {
		$this->order->update_meta_data( WC_Gateway_Solverr::META_INVOICE_ID, self::OLD_INVOICE );
		$this->order->update_meta_data( WC_Gateway_Solverr::META_INVOICE_IDS, array( self::OLD_INVOICE ) );
	}

	private static function pay(): array {
		return self::gateway()->process_payment( self::ORDER_ID );
	}

	private function assert_reused(): void {
		self::assertSame( array( 'result' => 'success', 'redirect' => self::BASE_URL . '/pay/' . self::OLD_INVOICE ), self::pay() );
		self::assertSame( array( self::BASE_URL . '/api/v1/invoices/' . self::OLD_INVOICE ), array_column( self::requests(), 0 ) );
		self::assertSame( 'GET', self::requests()[0][1]['method'] );
		self::assertSame( self::OLD_INVOICE, $this->order->get_meta( WC_Gateway_Solverr::META_INVOICE_ID ) );
		self::assertSame( array( self::OLD_INVOICE ), WC_Gateway_Solverr::order_invoice_ids( $this->order ) );
		self::assertSame( array(), $this->order->notes );
		self::assertSame( 0, $this->order->saves );
	}

	/** The old invoice was looked up and a new one created with the order's second key, recorded after it. */
	private function assert_replaced(): void {
		self::assertSame( array( 'result' => 'success', 'redirect' => self::BASE_URL . '/pay/' . self::NEW_INVOICE ), self::pay() );
		self::assertSame( array( 'GET', 'POST' ), array_map( fn ( array $request ): string => $request[1]['method'], self::requests() ) );
		self::assertSame( array( 'wc-order-7-2' ), self::creation_keys() );
		self::assertSame( '25.00', self::body( 1 )['amount'] );
		self::assertSame( 'USD', self::body( 1 )['currency'] );
		self::assertSame( self::NEW_INVOICE, $this->order->get_meta( WC_Gateway_Solverr::META_INVOICE_ID ) );
		self::assertSame( array( self::OLD_INVOICE, self::NEW_INVOICE ), WC_Gateway_Solverr::order_invoice_ids( $this->order ) );
		self::assertSame( array( 'Solverr invoice inv_new created.' ), $this->order->notes );
	}

	/** @return iterable<string, array{string}> */
	public static function payments_under_way(): iterable {
		yield 'detected' => array( 'detected' );
		yield 'processing' => array( 'processing' );
		yield 'paid' => array( 'paid' );
	}

	#[DataProvider( 'payments_under_way' )]
	public function test_invoice_with_a_payment_under_way_is_reused_even_after_it_expired( string $status ): void {
		$this->with_old_invoice();
		self::queue( self::response( 200, self::invoice( array( 'id' => self::OLD_INVOICE, 'status' => $status, 'expires_at' => self::expires_in( -60 ) ) ) ) );

		$this->assert_reused();
	}

	/** @return iterable<string, array{string}> */
	public static function unpaid_statuses(): iterable {
		yield 'created' => array( 'created' );
		yield 'awaiting payment' => array( 'awaiting_payment' );
	}

	#[DataProvider( 'unpaid_statuses' )]
	public function test_unpaid_invoice_with_at_least_ten_minutes_left_is_reused( string $status ): void {
		$this->with_old_invoice();
		self::queue( self::response( 200, self::invoice( array( 'id' => self::OLD_INVOICE, 'status' => $status, 'expires_at' => self::expires_in( 605 ) ) ) ) );

		$this->assert_reused();
	}

	#[DataProvider( 'unpaid_statuses' )]
	public function test_unpaid_invoice_with_less_than_ten_minutes_left_is_replaced( string $status ): void {
		$this->with_old_invoice();
		self::queue(
			self::response( 200, self::invoice( array( 'id' => self::OLD_INVOICE, 'status' => $status, 'expires_at' => self::expires_in( 595 ) ) ) ),
			self::response( 201, self::invoice() )
		);

		$this->assert_replaced();
	}

	public function test_unpaid_invoice_with_an_unreadable_expiry_is_replaced(): void {
		$this->with_old_invoice();
		self::queue(
			self::response( 200, self::invoice( array( 'id' => self::OLD_INVOICE, 'expires_at' => 'soon' ) ) ),
			self::response( 201, self::invoice() )
		);

		$this->assert_replaced();
	}

	/** @return iterable<string, array{array<string, string>}> Fields of an otherwise reusable invoice that no longer match the order. */
	public static function changed_orders(): iterable {
		yield 'lower total' => array( array( 'amount' => '20.00' ) );
		yield 'total written without decimals' => array( array( 'amount' => '25' ) );
		yield 'other currency' => array( array( 'currency' => 'EUR' ) );
	}

	/** @param array<string, string> $fields */
	#[DataProvider( 'changed_orders' )]
	public function test_invoice_for_another_total_or_currency_is_replaced( array $fields ): void {
		$this->with_old_invoice();
		self::queue(
			self::response( 200, self::invoice( array( 'id' => self::OLD_INVOICE, 'status' => 'detected' ) + $fields ) ),
			self::response( 201, self::invoice() )
		);

		$this->assert_replaced();
	}

	/** @return iterable<string, array{string}> */
	public static function ended_statuses(): iterable {
		yield 'underpaid' => array( 'underpaid' );
		yield 'failed' => array( 'failed' );
		yield 'refunded' => array( 'refunded' );
		yield 'expired' => array( 'expired' );
	}

	#[DataProvider( 'ended_statuses' )]
	public function test_ended_invoice_is_never_reused( string $status ): void {
		$this->with_old_invoice();
		self::queue(
			self::response( 200, self::invoice( array( 'id' => self::OLD_INVOICE, 'status' => $status ) ) ),
			self::response( 201, self::invoice() )
		);

		$this->assert_replaced();
	}

	public function test_invoice_unknown_to_solverr_is_replaced(): void {
		$this->with_old_invoice();
		self::queue( self::api_error( 404, 'not_found', 'No such invoice.' ), self::response( 201, self::invoice() ) );

		$this->assert_replaced();
	}

	public function test_lookup_error_fails_the_payment_without_creating_an_invoice(): void {
		$this->with_old_invoice();
		self::queue( self::api_error( 401, 'authentication_failed', 'Invalid API key.' ) );

		self::assertSame( array( 'result' => 'failure' ), self::pay() );
		self::assertSame( array(), self::creation_keys() );
		self::assertSame( array( array( self::START_NOTICE, 'error' ) ), $GLOBALS['solverr_test_notices'] );
		self::assertSame( array( array( 'error', 'Order 7: Solverr API returned HTTP 401: Invalid API key.', array( 'source' => 'solverr' ) ) ), wc_get_logger()->entries );
		self::assertSame( self::OLD_INVOICE, $this->order->get_meta( WC_Gateway_Solverr::META_INVOICE_ID ) );
	}

	public function test_first_invoice_is_created_with_the_order_key_and_fields(): void {
		self::queue( self::response( 201, self::invoice() ) );

		self::assertSame( array( 'result' => 'success', 'redirect' => self::BASE_URL . '/pay/' . self::NEW_INVOICE ), self::pay() );
		self::assertSame( array( self::BASE_URL . '/api/v1/invoices' ), array_column( self::requests(), 0 ) );
		self::assertSame( array( 'wc-order-7' ), self::creation_keys() );
		self::assertSame(
			array(
				'amount'         => '25.00',
				'currency'       => 'USD',
				'order_id'       => '7',
				'description'    => 'Order 7 from Beans & Co',
				'redirect_url'   => 'https://shop.example/checkout/order-received/7/',
				'metadata'       => array( 'wc_order_id' => '7' ),
				'customer_email' => 'buyer@example.com',
			),
			self::body( 0 )
		);
		self::assertSame( self::NEW_INVOICE, $this->order->get_meta( WC_Gateway_Solverr::META_INVOICE_ID ) );
		self::assertSame( array( self::NEW_INVOICE ), $this->order->get_meta( WC_Gateway_Solverr::META_INVOICE_IDS ) );
		self::assertSame( 1, $this->order->saves );
		self::assertSame( array( 'Solverr invoice inv_new created.' ), $this->order->notes );
	}

	public function test_invalid_billing_email_is_left_out_of_the_invoice(): void {
		$this->order->billing_email = 'buyer at example';
		self::queue( self::response( 201, self::invoice() ) );

		self::pay();

		self::assertArrayNotHasKey( 'customer_email', self::body( 0 ) );
	}

	public function test_description_is_cut_to_500_characters(): void {
		$GLOBALS['solverr_test_bloginfo']['name'] = str_repeat( 'é', 600 );
		self::queue( self::response( 201, self::invoice() ) );

		self::pay();

		self::assertSame( 'Order 7 from ' . str_repeat( 'é', 487 ), self::body( 0 )['description'] );
	}

	public function test_refused_customer_email_is_dropped_and_the_same_key_tried_again(): void {
		self::queue(
			self::api_error( 400, 'invalid_request', 'customer_email must be an email address.', 'customer_email' ),
			self::response( 201, self::invoice() )
		);

		self::assertSame( 'success', self::pay()['result'] );
		self::assertSame( array( 'wc-order-7', 'wc-order-7' ), self::creation_keys() );
		self::assertSame( 'buyer@example.com', self::body( 0 )['customer_email'] );
		self::assertArrayNotHasKey( 'customer_email', self::body( 1 ) );
		self::assertSame( array( self::NEW_INVOICE ), WC_Gateway_Solverr::order_invoice_ids( $this->order ) );
	}

	public function test_customer_email_is_dropped_only_once(): void {
		$refused = self::api_error( 400, 'invalid_request', 'customer_email must be an email address.', 'customer_email' );
		self::queue( $refused, $refused );

		self::assertSame( array( 'result' => 'failure' ), self::pay() );
		self::assertSame( array( 'wc-order-7', 'wc-order-7' ), self::creation_keys() );
		self::assertSame( '', $this->order->get_meta( WC_Gateway_Solverr::META_INVOICE_ID ) );
	}

	public function test_other_invalid_field_fails_the_payment_without_another_try(): void {
		self::queue( self::api_error( 400, 'invalid_request', 'amount is too large.', 'amount' ) );

		self::assertSame( array( 'result' => 'failure' ), self::pay() );
		self::assertSame( array( 'wc-order-7' ), self::creation_keys() );
	}

	public function test_key_used_with_another_request_moves_to_the_next_key(): void {
		self::queue(
			self::api_error( 409, 'idempotency_conflict', 'This Idempotency-Key was already used with a different request.', 'Idempotency-Key' ),
			self::response( 201, self::invoice() )
		);

		self::assertSame( 'success', self::pay()['result'] );
		self::assertSame( array( 'wc-order-7', 'wc-order-7-2' ), self::creation_keys() );
		self::assertSame( array( self::NEW_INVOICE ), WC_Gateway_Solverr::order_invoice_ids( $this->order ) );
	}

	public function test_replayed_invoice_that_can_no_longer_be_paid_moves_to_the_next_key(): void {
		self::queue(
			self::response( 201, self::invoice( array( 'id' => 'inv_replayed', 'status' => 'expired' ) ) ),
			self::response( 201, self::invoice() )
		);

		self::assertSame( self::BASE_URL . '/pay/' . self::NEW_INVOICE, self::pay()['redirect'] );
		self::assertSame( array( 'wc-order-7', 'wc-order-7-2' ), self::creation_keys() );
		self::assertSame( array( self::NEW_INVOICE ), WC_Gateway_Solverr::order_invoice_ids( $this->order ) );
	}

	public function test_key_still_being_processed_past_the_client_wait_fails_the_payment(): void {
		self::queue( self::api_error( 409, 'idempotency_conflict', 'A request with this Idempotency-Key is still being processed. Retry shortly.', 'Idempotency-Key', array( 'Retry-After' => '30' ) ) );

		self::assertSame( array( 'result' => 'failure' ), self::pay() );
		self::assertSame( array( 'wc-order-7' ), self::creation_keys() );
		self::assertSame( array( array( self::START_NOTICE, 'error' ) ), $GLOBALS['solverr_test_notices'] );
		self::assertSame( 'Order 7: Solverr API returned HTTP 409: A request with this Idempotency-Key is still being processed. Retry shortly.', wc_get_logger()->entries[0][1] );
	}

	public function test_payment_fails_after_five_keys_counted_from_the_invoices_already_issued(): void {
		$this->order->update_meta_data( WC_Gateway_Solverr::META_INVOICE_IDS, array( 'inv_a', 'inv_b' ) );
		$conflict = self::api_error( 409, 'idempotency_conflict', 'This Idempotency-Key was already used with a different request.', 'Idempotency-Key' );
		self::queue( $conflict, $conflict, $conflict, $conflict, $conflict );

		self::assertSame( array( 'result' => 'failure' ), self::pay() );
		self::assertSame( array( 'wc-order-7-3', 'wc-order-7-4', 'wc-order-7-5', 'wc-order-7-6', 'wc-order-7-7' ), self::creation_keys() );
		self::assertSame( 'Order 7: No unused idempotency key was left for this order.', wc_get_logger()->entries[0][1] );
		self::assertSame( array( 'inv_a', 'inv_b' ), WC_Gateway_Solverr::order_invoice_ids( $this->order ) );
	}

	/** @return iterable<string, array{array<string, mixed>, string}> Invoice fields and the logged reason. */
	public static function malformed_invoices(): iterable {
		yield 'missing expiry' => array( array( 'expires_at' => null ), 'The invoice response has no expires_at.' );
		yield 'status not a string' => array( array( 'status' => array( 'paid' ) ), 'The invoice response has no status.' );
		yield 'script checkout URL' => array( array( 'checkout_url' => 'javascript:alert(1)' ), 'The invoice response has an invalid checkout_url.' );
	}

	/** @param array<string, mixed> $fields */
	#[DataProvider( 'malformed_invoices' )]
	public function test_malformed_invoice_response_fails_the_payment( array $fields, string $reason ): void {
		self::queue( self::response( 201, $fields + self::invoice() ) );

		self::assertSame( array( 'result' => 'failure' ), self::pay() );
		self::assertSame( 'Order 7: ' . $reason, wc_get_logger()->entries[0][1] );
		self::assertSame( '', $this->order->get_meta( WC_Gateway_Solverr::META_INVOICE_ID ) );
	}

	public function test_unknown_order_fails_without_a_request(): void {
		self::assertSame( array( 'result' => 'failure' ), self::gateway()->process_payment( 8 ) );
		self::assertSame( array(), self::requests() );
	}
}
