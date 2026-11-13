<?php
/** Receives signed Solverr webhooks and updates orders.
    @package Solverr\WooCommerce */

defined( 'ABSPATH' ) || exit;

/** Verifies a Solverr webhook and applies its invoice event to the matching order. */
final class Solverr_Webhook_Handler {

	private const TOLERANCE_SECONDS = 300;
	private const MAX_STORED_EVENTS = 50;
	private const SECRET_PREFIX     = 'whsec_';
	private const SECRET_MIN_BYTES  = 24;
	private const SIGNATURE_VERSION = 'v1,';
	/** Wait for another delivery's order lock; Solverr pauses endpoints whose failures take 5 s or more, and retries a 503 later. */
	private const LOCK_WAIT_SECONDS = 3;
	/** Age after which a lock left by a request that died is taken over; applying one event takes far less. */
	private const LOCK_STALE_SECONDS = 30;
	private const LOCK_PREFIX        = '_solverr_order_lock_';

	/** @param WC_Gateway_Solverr $gateway Gateway holding the webhook secret. */
	public function __construct( private readonly WC_Gateway_Solverr $gateway ) {}

	/** Entry point for `woocommerce_api_solverr`. */
	public static function handle_request(): void {
		$gateway = WC()->payment_gateways()->payment_gateways()[ WC_Gateway_Solverr::ID ] ?? null;
		if ( ! $gateway instanceof WC_Gateway_Solverr ) {
			self::respond( 503, 'gateway_unavailable' );
		}
		( new self( $gateway ) )->handle();
	}

	/** Verifies the request and applies the event. */
	public function handle(): void {
		if ( 'POST' !== ( $_SERVER['REQUEST_METHOD'] ?? '' ) ) {
			self::respond( 405, 'method_not_allowed' );
		}

		$secret = $this->gateway->get_webhook_secret();
		if ( '' === $secret ) {
			self::respond( 503, 'not_configured' );
		}

		$raw_body   = (string) file_get_contents( 'php://input' );
		$message_id = self::header( 'HTTP_WEBHOOK_ID' );
		$timestamp  = self::header( 'HTTP_WEBHOOK_TIMESTAMP' );
		$signatures = self::header( 'HTTP_WEBHOOK_SIGNATURE' );
		$key        = self::secret_key( $secret );

		if ( null === $key || '' === $message_id || ! self::signature_matches( $message_id . '.' . $timestamp . '.' . $raw_body, $key, $signatures ) ) {
			self::respond( 401, 'invalid_signature' );
		}
		if ( ! ctype_digit( $timestamp ) || abs( time() - (int) $timestamp ) > self::TOLERANCE_SECONDS ) {
			self::respond( 400, 'stale_timestamp' );
		}

		$event = json_decode( $raw_body, true );
		if ( ! is_array( $event ) || ! is_string( $event['id'] ?? null ) || ! is_string( $event['type'] ?? null ) ) {
			self::respond( 400, 'invalid_payload' );
		}
		if ( $message_id !== $event['id'] ) {
			self::respond( 400, 'event_id_mismatch' );
		}

		$invoice  = $event['data']['invoice'] ?? null;
		$order_id = is_array( $invoice ) ? absint( $invoice['metadata']['wc_order_id'] ?? 0 ) : 0;
		/** Deliveries for one order can arrive at once (a retry, or two paid invoices), so they take turns before the order is read. */
		if ( 0 !== $order_id && ! self::lock_order( $order_id ) ) {
			self::respond( 503, 'order_busy' );
		}
		$order = is_array( $invoice ) ? $this->find_order( $invoice ) : null;
		if ( null === $order ) {
			self::respond( 200, 'ignored' );
		}
		if ( in_array( $event['id'], self::processed_event_ids( $order ), true ) ) {
			self::respond( 200, 'duplicate' );
		}

		$this->apply( $event['type'], $invoice, $order );
		self::remember_event( $order, $event['id'] );
		self::respond( 200, 'processed' );
	}

	/** Finds the order named in the invoice metadata, only when that invoice was issued for it. The order may have moved to another
	    payment method since, as when the customer chose another gateway and then paid the invoice from a tab still open.
	    @param array<string, mixed> $invoice Invoice from the event. */
	private function find_order( array $invoice ): ?WC_Order {
		$order_id   = absint( $invoice['metadata']['wc_order_id'] ?? 0 );
		$invoice_id = is_string( $invoice['id'] ?? null ) ? $invoice['id'] : '';
		if ( 0 === $order_id || '' === $invoice_id ) {
			return null;
		}

		$order = wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order ) {
			return null;
		}
		return in_array( $invoice_id, WC_Gateway_Solverr::order_invoice_ids( $order ), true ) ? $order : null;
	}

	/** Updates the matching order for one invoice event of type `$type`.
	    @param array<string, mixed> $invoice Invoice from the event. */
	private function apply( string $type, array $invoice, WC_Order $order ): void {
		$invoice_id = sanitize_text_field( $invoice['id'] );
		/** An order moved to another payment method no longer waits on its Solverr invoice, so that invoice ending does not cancel or fail it. */
		$is_current = $invoice_id === $order->get_meta( WC_Gateway_Solverr::META_INVOICE_ID ) && WC_Gateway_Solverr::ID === $order->get_payment_method();

		switch ( $type ) {
			case 'invoice.paid':
				if ( $order->is_paid() ) {
					if ( $order->get_transaction_id() !== $invoice_id ) {
						/* translators: %s: Solverr invoice id. */
						$order->add_order_note( sprintf( __( 'Solverr invoice %s was also paid, but this order was already paid. Refund the extra payment from your Solverr dashboard.', 'solverr-woocommerce' ), $invoice_id ) );
					}
					return;
				}
				if ( WC_Gateway_Solverr::ID !== $order->get_payment_method() ) {
					/* translators: %s: Solverr invoice id. */
					$order->add_order_note( sprintf( __( 'Solverr invoice %s was paid after the order had moved to another payment method, so the payment method is set back to Solverr.', 'solverr-woocommerce' ), $invoice_id ) );
					$order->set_payment_method( $this->gateway );
				}
				$mismatch = $this->paid_mismatch_note( $invoice, $invoice_id, $order );
				if ( null !== $mismatch ) {
					$order->update_status( 'on-hold', $mismatch );
					return;
				}
				$order->add_order_note( $this->paid_note( $invoice, $invoice_id ) );
				$order->payment_complete( $invoice_id );
				return;

			case 'invoice.expired':
				/** An order on hold waits for the merchant, for example after a payment that did not match it, so only a pending order is cancelled. */
				if ( $is_current && $order->has_status( 'pending' ) ) {
					/* translators: %s: Solverr invoice id. */
					$order->update_status( 'cancelled', sprintf( __( 'Solverr invoice %s expired before it was paid.', 'solverr-woocommerce' ), $invoice_id ) );
				}
				return;

			case 'invoice.failed':
				/* translators: %s: Solverr invoice id. */
				$note = sprintf( __( 'A payment for Solverr invoice %s failed during the swap. Solverr opened a support case for it.', 'solverr-woocommerce' ), $invoice_id );
				if ( $is_current && 'failed' === ( $invoice['status'] ?? '' ) && ! $order->is_paid() ) {
					$order->update_status( 'failed', $note );
				} else {
					$order->add_order_note( $note );
				}
				return;

			case 'invoice.underpaid':
				/* translators: %s: Solverr invoice id. */
				$order->add_order_note( self::with_unpaid_notice( $order, sprintf( __( 'Less than the full amount arrived for Solverr invoice %s. NEAR Intents returns those coins to the payer.', 'solverr-woocommerce' ), $invoice_id ) ) );
				return;

			case 'invoice.refunded':
				/* translators: %s: Solverr invoice id. */
				$order->add_order_note( self::with_unpaid_notice( $order, sprintf( __( 'The coins sent for Solverr invoice %s were returned to the payer.', 'solverr-woocommerce' ), $invoice_id ) ) );
				return;

			case 'invoice.extra_payment':
				/* translators: %s: Solverr invoice id. */
				$order->add_order_note( sprintf( __( 'Solverr invoice %s received a second payment. Refund the extra payment from your Solverr dashboard.', 'solverr-woocommerce' ), $invoice_id ) );
				return;
		}
	}

	/** Order note explaining why a paid invoice is not live or does not match the order total, or null when it matches.
	    @param array<string, mixed> $invoice Invoice from the event; `$invoice_id` is its sanitized id. */
	private function paid_mismatch_note( array $invoice, string $invoice_id, WC_Order $order ): ?string {
		$mode     = is_string( $invoice['mode'] ?? null ) ? sanitize_text_field( $invoice['mode'] ) : '';
		$amount   = is_string( $invoice['amount'] ?? null ) ? sanitize_text_field( $invoice['amount'] ) : '';
		$currency = is_string( $invoice['currency'] ?? null ) ? sanitize_text_field( $invoice['currency'] ) : '';

		if ( 'live' !== $mode ) {
			return sprintf(
				/* translators: %s: Solverr invoice id. */
				__( 'Solverr invoice %s is not a live invoice, so no real funds reached you. The order is on hold. Check the payment in your Solverr dashboard before you ship the order.', 'solverr-woocommerce' ),
				$invoice_id
			);
		}
		if ( WC_Gateway_Solverr::order_amount( $order ) !== $amount || $order->get_currency() !== $currency ) {
			return sprintf(
				/* translators: 1: Solverr invoice id, 2: invoice amount, 3: invoice currency, 4: order total, 5: order currency. */
				__( 'Solverr invoice %1$s was paid for %2$s %3$s, but the order total is %4$s %5$s. The order is on hold. Check the payment in your Solverr dashboard before you ship the order.', 'solverr-woocommerce' ),
				$invoice_id,
				$amount,
				$currency,
				WC_Gateway_Solverr::order_amount( $order ),
				$order->get_currency()
			);
		}
		return null;
	}

	/** Order note for a paid invoice, with the amount the merchant received.
	    @param array<string, mixed> $invoice Invoice from the event; `$invoice_id` is its sanitized id. */
	private function paid_note( array $invoice, string $invoice_id ): string {
		$settlement = is_array( $invoice['settlement'] ?? null ) ? $invoice['settlement'] : array();
		$amount     = is_string( $settlement['amount'] ?? null ) ? sanitize_text_field( $settlement['amount'] ) : '';
		$symbol     = is_string( $settlement['symbol'] ?? null ) ? sanitize_text_field( $settlement['symbol'] ) : '';

		$note = '' !== $amount && '' !== $symbol
			/* translators: 1: Solverr invoice id, 2: amount, 3: coin symbol. */
			? sprintf( __( 'Solverr invoice %1$s was paid. You received %2$s %3$s.', 'solverr-woocommerce' ), $invoice_id, $amount, $symbol )
			/* translators: %s: Solverr invoice id. */
			: sprintf( __( 'Solverr invoice %s was paid.', 'solverr-woocommerce' ), $invoice_id );

		if ( true === ( $invoice['late'] ?? false ) ) {
			$note .= ' ' . __( 'The payment arrived after the invoice expired or on a payment address that had already been replaced.', 'solverr-woocommerce' );
		}
		return $note;
	}

	/** `$note`, followed by a reminder that the order is still unpaid unless another invoice already paid it. */
	private static function with_unpaid_notice( WC_Order $order, string $note ): string {
		return $order->is_paid() ? $note : $note . ' ' . __( 'This order is still unpaid.', 'solverr-woocommerce' );
	}

	/** Takes the order's lock, an options row inserted only when absent (as WordPress's upgrader lock) and deleted when the request ends.
	    A lock older than LOCK_STALE_SECONDS, left by a request that died, is taken over; false when it stays held for LOCK_WAIT_SECONDS. */
	private static function lock_order( int $order_id ): bool {
		global $wpdb;
		$name = self::LOCK_PREFIX . $order_id;
		/** Timed on the monotonic clock, since a wall clock that steps (NTP, a resumed VM) would end the wait early or late. */
		$deadline = hrtime( true ) + self::LOCK_WAIT_SECONDS * 1_000_000_000;
		do {
			$value = time() . ' ' . wp_generate_password( 12, false );
			$taken = $wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO {$wpdb->options} ( option_name, option_value, autoload ) VALUES ( %s, %s, 'no' )", $name, $value ) );
			if ( ! $taken ) {
				$held  = (string) $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $name ) );
				$stale = '' !== $held && (int) $held < time() - self::LOCK_STALE_SECONDS;
				$taken = $stale && $wpdb->update( $wpdb->options, array( 'option_value' => $value ), array( 'option_name' => $name, 'option_value' => $held ) );
			}
			if ( $taken ) {
				register_shutdown_function( static fn() => $wpdb->delete( $wpdb->options, array( 'option_name' => $name, 'option_value' => $value ) ) );
				return true;
			}
			usleep( 200_000 );
		} while ( hrtime( true ) < $deadline );
		return false;
	}

	/** Event ids already applied to the order.
	    @return string[] */
	private static function processed_event_ids( WC_Order $order ): array {
		$ids = $order->get_meta( WC_Gateway_Solverr::META_EVENT_IDS );
		return is_array( $ids ) ? $ids : array();
	}

	/** Records an applied event id on the order, keeping the most recent ones. */
	private static function remember_event( WC_Order $order, string $event_id ): void {
		$ids   = self::processed_event_ids( $order );
		$ids[] = $event_id;
		$order->update_meta_data( WC_Gateway_Solverr::META_EVENT_IDS, array_slice( $ids, -self::MAX_STORED_EVENTS ) );
		$order->save();
	}

	/** The HMAC key of a `whsec_` secret (the base64 after the prefix, decoded), or null when malformed or shorter than a Solverr signing secret. */
	public static function secret_key( #[\SensitiveParameter] string $secret ): ?string {
		if ( ! str_starts_with( $secret, self::SECRET_PREFIX ) ) {
			return null;
		}
		$encoded = substr( $secret, strlen( self::SECRET_PREFIX ) );
		/** base64_decode() skips whitespace even in strict mode, so the alphabet is checked first, as in the PHP SDK. */
		$key = 1 === preg_match( '/^[A-Za-z0-9+\/]*={0,2}$/D', $encoded ) ? base64_decode( $encoded, true ) : false;
		return false === $key || strlen( $key ) < self::SECRET_MIN_BYTES ? null : $key;
	}

	/** Whether any `v1,<base64>` entry of the space-separated `webhook-signature` header (one per secret during a rotation)
	    signs `$content`, the request's `id.timestamp.body`, with the decoded `$key`. */
	private static function signature_matches( string $content, #[\SensitiveParameter] string $key, string $signatures ): bool {
		$expected = base64_encode( hash_hmac( 'sha256', $content, $key, true ) );
		foreach ( explode( ' ', $signatures ) as $entry ) {
			if ( str_starts_with( $entry, self::SIGNATURE_VERSION ) && hash_equals( $expected, substr( $entry, strlen( self::SIGNATURE_VERSION ) ) ) ) {
				return true;
			}
		}
		return false;
	}

	/** Reads a request header from its server variable `$name`, such as HTTP_WEBHOOK_SIGNATURE. */
	private static function header( string $name ): string {
		return isset( $_SERVER[ $name ] ) ? sanitize_text_field( wp_unslash( $_SERVER[ $name ] ) ) : '';
	}

	/** Sends a JSON response with HTTP `$status` and the short `$result` code, and ends the request. */
	private static function respond( int $status, string $result ): never {
		wp_send_json( array( 'result' => $result ), $status );
		exit;
	}
}
