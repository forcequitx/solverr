<?php
/** Stand-ins for the WordPress and WooCommerce classes the plugin extends or reads; WC_Order, WC_Logger and wpdb record what the plugin does.
    Solverr_Test_Response and Solverr_Test_Request_Body carry a webhook request's response and body.
    @package Solverr\WooCommerce\Tests */

declare(strict_types=1);

/** Base class of the gateway, with the id and title an order copies from it in set_payment_method(). */
abstract class WC_Payment_Gateway {

	/** @var string */
	public $id = '';
	/** @var string */
	public $title = '';
	/** @var array<string, mixed> */
	public $settings = array();

	public function get_title(): string {
		return $this->title;
	}

	/** The saved setting, or an empty string when the test set none. */
	public function get_option( string $key, mixed $empty_value = null ): mixed {
		return $this->settings[ $key ] ?? '';
	}

	/** The order received page of the order, as WooCommerce builds it with pretty permalinks. */
	public function get_return_url( ?WC_Order $order = null ): string {
		return 'https://shop.example/checkout/order-received/' . $order?->get_id() . '/';
	}
}

/** A transport error from the WordPress HTTP API. */
class WP_Error {

	public function __construct( public string $code = '', public string $message = '' ) {}

	public function get_error_message(): string {
		return $this->message;
	}
}

/** The response wp_send_json() would send, thrown in place of ending the request. */
final class Solverr_Test_Response extends RuntimeException {

	public function __construct( public readonly int $status, public readonly mixed $body ) {
		parent::__construct( 'HTTP ' . $status );
	}
}

/** WordPress's database object with the options table always free to lock: records each query and reports one row written. */
class wpdb {

	public string $options = 'wp_options';
	/** @var list<string> */
	public array $queries = array();

	/** The query with each %s replaced by its quoted argument. */
	public function prepare( string $query, mixed ...$args ): string {
		return vsprintf( str_replace( '%s', "'%s'", $query ), array_map( 'addslashes', array_map( 'strval', $args ) ) );
	}

	public function query( string $query ): int {
		$this->queries[] = $query;
		return 1;
	}

	/** @param array<string, mixed> $where */
	public function delete( string $table, array $where ): int {
		return 1;
	}
}

/** Serves `$body` as php://input while registered as the php:// stream wrapper; other php:// streams fail to open. */
final class Solverr_Test_Request_Body {

	public static string $body = '';
	/** @var resource|null */
	public $context;
	private int $position = 0;

	public function stream_open( string $path, string $mode, int $options, ?string &$opened_path ): bool {
		return 'php://input' === $path;
	}

	public function stream_read( int $count ): string {
		$chunk           = substr( self::$body, $this->position, $count );
		$this->position += strlen( $chunk );
		return $chunk;
	}

	public function stream_eof(): bool {
		return $this->position >= strlen( self::$body );
	}

	/** @return array<string, int> */
	public function stream_stat(): array {
		return array( 'size' => strlen( self::$body ) );
	}
}

/** Records what the plugin logs as `[level, message, context]`. */
class WC_Logger {

	/** @var list<array{string, string, array<string, mixed>}> */
	public array $entries = array();

	public function error( string $message, array $context = array() ): void {
		$this->entries[] = array( 'error', $message, $context );
	}
}

/** A fake order with settable state that records notes and payment completion. */
class WC_Order {

	public string $status               = 'pending';
	public string $transaction_id       = '';
	public string $payment_method       = 'solverr';
	public string $payment_method_title = 'Solverr';
	public string $billing_email        = '';
	/** @var array<string, mixed> */
	public array $meta = array();
	/** @var list<string> */
	public array $notes = array();
	public ?string $completed_with = null;
	public int $saves = 0;

	public function __construct( public int $id = 7, public float|string $total = '25.00', public string $currency = 'USD', public bool $paid = false ) {}

	public function get_id(): int {
		return $this->id;
	}

	public function get_total(): float|string {
		return $this->total;
	}

	public function get_currency(): string {
		return $this->currency;
	}

	/** The order id as a string, as WooCommerce returns it when no plugin changes order numbers. */
	public function get_order_number(): string {
		return (string) $this->id;
	}

	public function get_billing_email(): string {
		return $this->billing_email;
	}

	public function is_paid(): bool {
		return $this->paid;
	}

	public function has_status( string $status ): bool {
		return $this->status === $status;
	}

	public function get_payment_method(): string {
		return $this->payment_method;
	}

	/** As WooCommerce: a gateway sets both the id and the title, a string only the id. */
	public function set_payment_method( WC_Payment_Gateway|string $payment_method ): void {
		if ( $payment_method instanceof WC_Payment_Gateway ) {
			$this->payment_method       = $payment_method->id;
			$this->payment_method_title = $payment_method->get_title();
			return;
		}
		$this->payment_method = $payment_method;
	}

	public function get_transaction_id(): string {
		return $this->transaction_id;
	}

	public function get_meta( string $key ): mixed {
		return $this->meta[ $key ] ?? '';
	}

	public function update_meta_data( string $key, mixed $value ): void {
		$this->meta[ $key ] = $value;
	}

	public function save(): void {
		++$this->saves;
	}

	public function add_order_note( string $note ): void {
		$this->notes[] = $note;
	}

	public function update_status( string $status, string $note = '' ): void {
		$this->status = $status;
	}

	public function payment_complete( string $transaction_id ): void {
		$this->paid           = true;
		$this->transaction_id = $transaction_id;
		$this->completed_with = $transaction_id;
	}
}
