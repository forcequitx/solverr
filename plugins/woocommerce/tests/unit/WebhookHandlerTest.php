<?php
/** Unit tests for Solverr_Webhook_Handler: its helpers, and signed requests sent through handle().
    @package Solverr\WooCommerce\Tests */

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class WebhookHandlerTest extends TestCase {

	private const INVOICE_ID = 'inv_1';

	private static function call_private( string $method, ?object $instance, mixed ...$args ): mixed {
		return ( new ReflectionMethod( Solverr_Webhook_Handler::class, $method ) )->invoke( $instance, ...$args );
	}

	/** A handler without its gateway; the methods under test never read it. */
	private static function handler(): Solverr_Webhook_Handler {
		return ( new ReflectionClass( Solverr_Webhook_Handler::class ) )->newInstanceWithoutConstructor();
	}

	/** A handler whose gateway has the id and title an order copies when its payment method is set back to Solverr. */
	private static function handler_with_gateway(): Solverr_Webhook_Handler {
		$gateway        = ( new ReflectionClass( WC_Gateway_Solverr::class ) )->newInstanceWithoutConstructor();
		$gateway->id    = WC_Gateway_Solverr::ID;
		$gateway->title = 'Crypto (Solverr)';
		return new Solverr_Webhook_Handler( $gateway );
	}

	/** An order for the current invoice that the customer moved to direct bank transfer. */
	private static function switched_order(): WC_Order {
		$order                       = self::current_order();
		$order->payment_method       = 'bacs';
		$order->payment_method_title = 'Direct bank transfer';
		$order->update_meta_data( WC_Gateway_Solverr::META_INVOICE_IDS, array( 'inv_0', self::INVOICE_ID ) );
		return $order;
	}

	private static function new_secret( int $bytes = 32 ): string {
		do {
			$encoded = base64_encode( random_bytes( $bytes ) );
		} while ( false === strpbrk( $encoded, '+/' ) );
		return 'whsec_' . $encoded;
	}

	private static function sign( string $content, string $key ): string {
		return base64_encode( hash_hmac( 'sha256', $content, $key, true ) );
	}

	/** @param array<string, mixed> $overrides */
	private static function invoice( array $overrides = array() ): array {
		return $overrides + array(
			'id'         => self::INVOICE_ID,
			'mode'       => 'live',
			'amount'     => '25.00',
			'currency'   => 'USD',
			'status'     => 'paid',
			'settlement' => array( 'amount' => '24.9', 'symbol' => 'USDC' ),
		);
	}

	private static function current_order( bool $paid = false ): WC_Order {
		$order = new WC_Order( 7, '25.00', 'USD', $paid );
		$order->update_meta_data( WC_Gateway_Solverr::META_INVOICE_ID, self::INVOICE_ID );
		return $order;
	}

	public function test_secret_key_decodes_the_standard_base64_after_the_prefix(): void {
		$raw = random_bytes( 32 );
		self::assertSame( $raw, Solverr_Webhook_Handler::secret_key( 'whsec_' . base64_encode( $raw ) ) );
		self::assertSame( $raw, Solverr_Webhook_Handler::secret_key( 'whsec_' . rtrim( base64_encode( $raw ), '=' ) ) );
	}

	/** @return iterable<string, array{\Closure(string): string}> Each case builds a bad secret from a valid one. */
	public static function bad_secrets(): iterable {
		yield 'missing prefix' => array( fn ( string $secret ): string => substr( $secret, 6 ) );
		yield 'other prefix' => array( fn ( string $secret ): string => 'whsk_' . substr( $secret, 6 ) );
		yield 'url-safe alphabet' => array( fn ( string $secret ): string => strtr( $secret, '+/', '-_' ) );
		yield 'too short' => array( fn ( string $secret ): string => 'whsec_' . base64_encode( random_bytes( 23 ) ) );
		yield 'empty key' => array( fn ( string $secret ): string => 'whsec_' );
		yield 'not base64' => array( fn ( string $secret ): string => 'whsec_' . str_repeat( '!', 44 ) );
	}

	/** @param \Closure(string): string $build */
	#[DataProvider( 'bad_secrets' )]
	public function test_secret_key_refuses_malformed_or_short_secrets( \Closure $build ): void {
		self::assertNull( Solverr_Webhook_Handler::secret_key( $build( self::new_secret() ) ) );
	}

	public function test_secret_key_refuses_whitespace_inside_the_secret(): void {
		$secret = self::new_secret();
		$spaced = substr( $secret, 0, 26 ) . ' ' . substr( $secret, 26 );
		self::assertNull( Solverr_Webhook_Handler::secret_key( $spaced ) );
	}

	public function test_signature_matches_a_v1_entry_signed_with_the_key(): void {
		$key = random_bytes( 32 );
		self::assertTrue( self::call_private( 'signature_matches', null, 'evt_1.1700000000.{}', $key, 'v1,' . self::sign( 'evt_1.1700000000.{}', $key ) ) );
	}

	public function test_signature_matches_any_entry_during_a_secret_rotation(): void {
		$key   = random_bytes( 32 );
		$other = 'v1,' . self::sign( 'evt_1.1.{}', random_bytes( 32 ) );
		self::assertTrue( self::call_private( 'signature_matches', null, 'evt_1.1.{}', $key, $other . ' v1,' . self::sign( 'evt_1.1.{}', $key ) ) );
	}

	/** @return iterable<string, array{\Closure(string, string): string}> Each case turns the content and its valid signature into a header that must fail. */
	public static function bad_signatures(): iterable {
		yield 'other content' => array( fn ( string $content, string $signature ): string => 'v1,' . $signature . 'x' );
		yield 'other version' => array( fn ( string $content, string $signature ): string => 'v2,' . $signature );
		yield 'no version' => array( fn ( string $content, string $signature ): string => $signature );
		yield 'unpadded' => array( fn ( string $content, string $signature ): string => 'v1,' . rtrim( $signature, '=' ) );
		yield 'url-safe' => array( fn ( string $content, string $signature ): string => 'v1,' . strtr( $signature, '+/', '-_' ) . ( strpbrk( $signature, '+/' ) ? '' : 'x' ) );
		yield 'empty header' => array( fn ( string $content, string $signature ): string => '' );
		yield 'non-canonical base64' => array(
			function ( string $content, string $signature ): string {
				$alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
				return 'v1,' . substr( $signature, 0, 42 ) . $alphabet[ strpos( $alphabet, $signature[42] ) ^ 1 ] . substr( $signature, 43 );
			},
		);
	}

	/** @param \Closure(string, string): string $build */
	#[DataProvider( 'bad_signatures' )]
	public function test_signature_matches_refuses_other_signatures( \Closure $build ): void {
		$key     = random_bytes( 32 );
		$content = 'evt_1.1700000000.{"id":"evt_1"}';
		self::assertFalse( self::call_private( 'signature_matches', null, $content, $key, $build( $content, self::sign( $content, $key ) ) ) );
	}

	public function test_signature_with_another_key_does_not_match(): void {
		self::assertFalse( self::call_private( 'signature_matches', null, 'a', random_bytes( 32 ), 'v1,' . self::sign( 'a', random_bytes( 32 ) ) ) );
	}

	public function test_paid_mismatch_note_is_null_when_a_live_invoice_matches_the_order(): void {
		self::assertNull( self::call_private( 'paid_mismatch_note', self::handler(), self::invoice(), self::INVOICE_ID, new WC_Order( 7, 25 ) ) );
	}

	/** @return iterable<string, array{array<string, mixed>, string}> */
	public static function non_live_invoices(): iterable {
		yield 'test mode' => array( array( 'mode' => 'test' ), 'test' );
		yield 'missing mode' => array( array( 'mode' => null ), 'null' );
		yield 'mode not a string' => array( array( 'mode' => array( 'live' ) ), 'array' );
	}

	/** @param array<string, mixed> $override */
	#[DataProvider( 'non_live_invoices' )]
	public function test_paid_mismatch_note_holds_an_invoice_that_is_not_live( array $override, string $label ): void {
		$note = self::call_private( 'paid_mismatch_note', self::handler(), self::invoice( $override ), self::INVOICE_ID, new WC_Order() );
		self::assertSame( 'Solverr invoice inv_1 is not a live invoice, so no real funds reached you. The order is on hold. Check the payment in your Solverr dashboard before you ship the order.', $note, $label );
	}

	/** @return iterable<string, array{array<string, mixed>, WC_Order, string}> Invoice fields, order, and the "paid for … but the order total is …" part of the note. */
	public static function mismatches(): iterable {
		yield 'lower amount' => array( array( 'amount' => '24.99' ), new WC_Order( 7, '25.00' ), 'paid for 24.99 USD, but the order total is 25.00 USD' );
		yield 'amount without decimals' => array( array( 'amount' => '25' ), new WC_Order( 7, '25.00' ), 'paid for 25 USD, but the order total is 25.00 USD' );
		yield 'other currency' => array( array( 'currency' => 'EUR' ), new WC_Order( 7, '25.00', 'USD' ), 'paid for 25.00 EUR, but the order total is 25.00 USD' );
		yield 'missing amount' => array( array( 'amount' => null ), new WC_Order( 7, '25.00' ), 'paid for  USD, but the order total is 25.00 USD' );
	}

	/** @param array<string, mixed> $override */
	#[DataProvider( 'mismatches' )]
	public function test_paid_mismatch_note_names_both_amounts_when_they_differ( array $override, WC_Order $order, string $expected ): void {
		$note = self::call_private( 'paid_mismatch_note', self::handler(), self::invoice( $override ), self::INVOICE_ID, $order );
		self::assertStringContainsString( "Solverr invoice inv_1 was {$expected}. The order is on hold.", (string) $note );
	}

	public function test_paid_mismatch_note_sanitizes_invoice_fields(): void {
		$note = self::call_private( 'paid_mismatch_note', self::handler(), self::invoice( array( 'amount' => "<b>1</b>\n" ) ), self::INVOICE_ID, new WC_Order() );
		self::assertStringContainsString( 'paid for 1 USD', (string) $note );
	}

	public function test_with_unpaid_notice_adds_the_reminder_only_to_an_unpaid_order(): void {
		self::assertSame( 'Coins returned. This order is still unpaid.', self::call_private( 'with_unpaid_notice', null, new WC_Order( paid: false ), 'Coins returned.' ) );
		self::assertSame( 'Coins returned.', self::call_private( 'with_unpaid_notice', null, new WC_Order( paid: true ), 'Coins returned.' ) );
	}

	public function test_header_reads_the_server_variable_unslashed_and_sanitized(): void {
		$_SERVER['HTTP_WEBHOOK_ID'] = "evt\\'1 <b>x</b>\n";
		try {
			self::assertSame( "evt'1 x", self::call_private( 'header', null, 'HTTP_WEBHOOK_ID' ) );
			self::assertSame( '', self::call_private( 'header', null, 'HTTP_WEBHOOK_MISSING' ) );
		} finally {
			unset( $_SERVER['HTTP_WEBHOOK_ID'] );
		}
	}

	public function test_paid_event_completes_a_matching_order_with_the_received_amount(): void {
		$order = self::current_order();
		self::call_private( 'apply', self::handler(), 'invoice.paid', self::invoice( array( 'late' => true ) ), $order );
		self::assertSame( self::INVOICE_ID, $order->completed_with );
		self::assertSame( array( 'Solverr invoice inv_1 was paid. You received 24.9 USDC. The payment arrived after the invoice expired or on a payment address that had already been replaced.' ), $order->notes );
	}

	public function test_paid_event_that_does_not_match_puts_the_order_on_hold_unpaid(): void {
		$order = self::current_order();
		self::call_private( 'apply', self::handler(), 'invoice.paid', self::invoice( array( 'amount' => '1.00' ) ), $order );
		self::assertNull( $order->completed_with );
		self::assertSame( 'on-hold', $order->status );
	}

	public function test_second_paid_invoice_on_a_paid_order_only_adds_a_refund_note(): void {
		$order                 = self::current_order( paid: true );
		$order->transaction_id = 'inv_0';
		self::call_private( 'apply', self::handler(), 'invoice.paid', self::invoice(), $order );
		self::assertSame( 'inv_0', $order->transaction_id );
		self::assertStringContainsString( 'was also paid', $order->notes[0] );
	}

	public function test_expired_event_cancels_only_a_pending_order_for_its_current_invoice(): void {
		$pending = self::current_order();
		self::call_private( 'apply', self::handler(), 'invoice.expired', self::invoice( array( 'status' => 'expired' ) ), $pending );
		self::assertSame( 'cancelled', $pending->status );

		$on_hold         = self::current_order();
		$on_hold->status = 'on-hold';
		self::call_private( 'apply', self::handler(), 'invoice.expired', self::invoice( array( 'status' => 'expired' ) ), $on_hold );
		self::assertSame( 'on-hold', $on_hold->status );

		$replaced = self::current_order();
		self::call_private( 'apply', self::handler(), 'invoice.expired', self::invoice( array( 'id' => 'inv_old' ) ), $replaced );
		self::assertSame( 'pending', $replaced->status );
	}

	public function test_failed_event_fails_only_an_unpaid_order_for_its_current_invoice(): void {
		$current = self::current_order();
		self::call_private( 'apply', self::handler(), 'invoice.failed', self::invoice( array( 'status' => 'failed' ) ), $current );
		self::assertSame( 'failed', $current->status );

		$paid = self::current_order( paid: true );
		self::call_private( 'apply', self::handler(), 'invoice.failed', self::invoice( array( 'status' => 'failed' ) ), $paid );
		self::assertSame( 'pending', $paid->status );
		self::assertCount( 1, $paid->notes );
	}

	public function test_find_order_finds_an_order_moved_to_another_payment_method_by_its_invoice_ids(): void {
		$order                          = self::switched_order();
		$GLOBALS['solverr_test_orders'] = array( 7 => $order );
		try {
			$invoice = self::invoice( array( 'metadata' => array( 'wc_order_id' => '7' ) ) );
			self::assertSame( $order, self::call_private( 'find_order', self::handler(), $invoice ) );
			self::assertNull( self::call_private( 'find_order', self::handler(), array( 'id' => 'inv_other' ) + $invoice ) );
			self::assertNull( self::call_private( 'find_order', self::handler(), self::invoice( array( 'metadata' => array( 'wc_order_id' => '8' ) ) ) ) );
		} finally {
			unset( $GLOBALS['solverr_test_orders'] );
		}
	}

	public function test_paid_event_sets_a_switched_order_back_to_solverr_and_completes_it(): void {
		$order = self::switched_order();
		self::call_private( 'apply', self::handler_with_gateway(), 'invoice.paid', self::invoice(), $order );
		self::assertSame( WC_Gateway_Solverr::ID, $order->payment_method );
		self::assertSame( 'Crypto (Solverr)', $order->payment_method_title );
		self::assertSame( self::INVOICE_ID, $order->completed_with );
		self::assertSame( 'Solverr invoice inv_1 was paid after the order had moved to another payment method, so the payment method is set back to Solverr.', $order->notes[0] );
		self::assertStringStartsWith( 'Solverr invoice inv_1 was paid. You received', $order->notes[1] );
	}

	public function test_paid_event_that_does_not_match_a_switched_order_sets_it_back_to_solverr_on_hold(): void {
		$order = self::switched_order();
		self::call_private( 'apply', self::handler_with_gateway(), 'invoice.paid', self::invoice( array( 'amount' => '1.00' ) ), $order );
		self::assertSame( WC_Gateway_Solverr::ID, $order->payment_method );
		self::assertSame( 'on-hold', $order->status );
		self::assertNull( $order->completed_with );
	}

	public function test_paid_event_leaves_a_solverr_order_without_a_payment_method_note(): void {
		$order = self::current_order();
		self::call_private( 'apply', self::handler(), 'invoice.paid', self::invoice(), $order );
		self::assertSame( 'Solverr', $order->payment_method_title );
		self::assertCount( 1, $order->notes );
	}

	public function test_paid_event_on_a_switched_order_already_paid_keeps_its_payment_method(): void {
		$order                 = self::switched_order();
		$order->paid           = true;
		$order->transaction_id = 'bank-ref';
		self::call_private( 'apply', self::handler(), 'invoice.paid', self::invoice(), $order );
		self::assertSame( 'bacs', $order->payment_method );
		self::assertStringContainsString( 'was also paid', $order->notes[0] );
	}

	public function test_expired_and_failed_events_leave_a_switched_order_pending(): void {
		$order = self::switched_order();
		self::call_private( 'apply', self::handler(), 'invoice.expired', self::invoice( array( 'status' => 'expired' ) ), $order );
		self::call_private( 'apply', self::handler(), 'invoice.failed', self::invoice( array( 'status' => 'failed' ) ), $order );
		self::assertSame( 'pending', $order->status );
		self::assertSame( 'bacs', $order->payment_method );
		self::assertCount( 1, $order->notes );
	}

	public function test_underpaid_event_notes_that_an_unpaid_order_is_still_unpaid(): void {
		$order = self::current_order();
		self::call_private( 'apply', self::handler(), 'invoice.underpaid', self::invoice(), $order );
		self::assertStringEndsWith( 'This order is still unpaid.', $order->notes[0] );
		self::assertSame( 'pending', $order->status );
	}

	protected function tearDown(): void {
		unset( $GLOBALS['solverr_test_orders'], $GLOBALS['wpdb'] );
	}

	/** A handler whose gateway holds `$secret` as its webhook secret. */
	private static function handler_with_secret( string $secret ): Solverr_Webhook_Handler {
		$gateway                             = ( new ReflectionClass( WC_Gateway_Solverr::class ) )->newInstanceWithoutConstructor();
		$gateway->settings['webhook_secret'] = $secret;
		return new Solverr_Webhook_Handler( $gateway );
	}

	/** Order 7 for the current invoice, found by wc_get_order(), with a database whose order lock is always free. */
	private static function stored_order(): WC_Order {
		$order = self::current_order();
		$order->update_meta_data( WC_Gateway_Solverr::META_INVOICE_IDS, array( self::INVOICE_ID ) );
		$GLOBALS['solverr_test_orders'] = array( 7 => $order );
		$GLOBALS['wpdb']                = new wpdb();
		return $order;
	}

	/** JSON body of event `$id` of type `$type` for the current invoice of order 7. */
	private static function event_body( string $id, string $type ): string {
		$invoice = self::invoice( array( 'metadata' => array( 'wc_order_id' => '7' ) ) );
		return (string) json_encode( array( 'id' => $id, 'type' => $type, 'data' => array( 'invoice' => $invoice ) ) );
	}

	/** @return array<string, string> Webhook headers of message `$id` sent at `$timestamp`, with `$body` signed by `$secret`. */
	private static function signed_headers( string $secret, string $id, int $timestamp, string $body ): array {
		return array(
			'HTTP_WEBHOOK_ID'        => $id,
			'HTTP_WEBHOOK_TIMESTAMP' => (string) $timestamp,
			'HTTP_WEBHOOK_SIGNATURE' => 'v1,' . self::sign( "{$id}.{$timestamp}.{$body}", (string) Solverr_Webhook_Handler::secret_key( $secret ) ),
		);
	}

	/** Runs handle() for a POST of `$body` with `$headers` and returns the response it sent.
	    @param array<string, string> $headers */
	private static function deliver( Solverr_Webhook_Handler $handler, string $body, array $headers ): Solverr_Test_Response {
		$server                          = $_SERVER;
		$_SERVER                         = array( 'REQUEST_METHOD' => 'POST' ) + $headers + $server;
		Solverr_Test_Request_Body::$body = $body;
		stream_wrapper_unregister( 'php' );
		stream_wrapper_register( 'php', Solverr_Test_Request_Body::class );
		try {
			$handler->handle();
		} catch ( Solverr_Test_Response $response ) {
			return $response;
		} finally {
			stream_wrapper_restore( 'php' );
			$_SERVER = $server;
		}
		self::fail( 'handle() returned without sending a response.' );
	}

	public function test_handle_applies_a_signed_paid_event_and_remembers_it(): void {
		$order    = self::stored_order();
		$secret   = self::new_secret();
		$body     = self::event_body( 'evt_1', 'invoice.paid' );
		$response = self::deliver( self::handler_with_secret( $secret ), $body, self::signed_headers( $secret, 'evt_1', time(), $body ) );

		self::assertSame( array( 200, array( 'result' => 'processed' ) ), array( $response->status, $response->body ) );
		self::assertSame( self::INVOICE_ID, $order->completed_with );
		self::assertSame( array( 'Solverr invoice inv_1 was paid. You received 24.9 USDC.' ), $order->notes );
		self::assertSame( array( 'evt_1' ), $order->get_meta( WC_Gateway_Solverr::META_EVENT_IDS ) );
		self::assertSame( 1, $order->saves );
		self::assertCount( 1, $GLOBALS['wpdb']->queries );
		self::assertStringContainsString( "VALUES ( '_solverr_order_lock_7', ", $GLOBALS['wpdb']->queries[0] );
	}

	public function test_handle_refuses_a_signature_made_with_another_secret_with_401(): void {
		$order    = self::stored_order();
		$body     = self::event_body( 'evt_1', 'invoice.paid' );
		$response = self::deliver( self::handler_with_secret( self::new_secret() ), $body, self::signed_headers( self::new_secret(), 'evt_1', time(), $body ) );

		self::assertSame( array( 401, array( 'result' => 'invalid_signature' ) ), array( $response->status, $response->body ) );
		self::assertNull( $order->completed_with );
		self::assertSame( array(), $GLOBALS['wpdb']->queries );
	}

	/** @return iterable<string, array{int}> Seconds between the signed timestamp and now. */
	public static function stale_offsets(): iterable {
		yield 'more than 5 minutes old' => array( -301 );
		yield 'more than 5 minutes ahead' => array( 301 );
	}

	#[DataProvider( 'stale_offsets' )]
	public function test_handle_refuses_a_correctly_signed_stale_timestamp_with_400( int $offset ): void {
		$order    = self::stored_order();
		$secret   = self::new_secret();
		$body     = self::event_body( 'evt_1', 'invoice.paid' );
		$response = self::deliver( self::handler_with_secret( $secret ), $body, self::signed_headers( $secret, 'evt_1', time() + $offset, $body ) );

		self::assertSame( array( 400, array( 'result' => 'stale_timestamp' ) ), array( $response->status, $response->body ) );
		self::assertNull( $order->completed_with );
	}

	public function test_handle_refuses_a_webhook_id_that_is_not_the_event_id_with_400(): void {
		$order    = self::stored_order();
		$secret   = self::new_secret();
		$body     = self::event_body( 'evt_1', 'invoice.paid' );
		$response = self::deliver( self::handler_with_secret( $secret ), $body, self::signed_headers( $secret, 'evt_2', time(), $body ) );

		self::assertSame( array( 400, array( 'result' => 'event_id_mismatch' ) ), array( $response->status, $response->body ) );
		self::assertNull( $order->completed_with );
	}

	public function test_handle_answers_a_repeated_event_as_duplicate_without_applying_it_again(): void {
		$order   = self::stored_order();
		$secret  = self::new_secret();
		$handler = self::handler_with_secret( $secret );
		$body    = self::event_body( 'evt_1', 'invoice.underpaid' );
		$headers = self::signed_headers( $secret, 'evt_1', time(), $body );

		self::assertSame( array( 'result' => 'processed' ), self::deliver( $handler, $body, $headers )->body );
		$repeat = self::deliver( $handler, $body, $headers );
		self::assertSame( array( 200, array( 'result' => 'duplicate' ) ), array( $repeat->status, $repeat->body ) );
		self::assertCount( 1, $order->notes );
		self::assertSame( array( 'evt_1' ), $order->get_meta( WC_Gateway_Solverr::META_EVENT_IDS ) );
		self::assertSame( 1, $order->saves );
	}
}
