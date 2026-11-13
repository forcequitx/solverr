<?php
/** Solverr payment gateway.
    @package Solverr\WooCommerce */

defined( 'ABSPATH' ) || exit;

/** Creates a Solverr invoice for each order and sends the customer to its checkout page. */
class WC_Gateway_Solverr extends WC_Payment_Gateway {

	public const ID                   = 'solverr';
	public const SUPPORTED_CURRENCIES = array( 'USD', 'EUR', 'INR' );
	public const META_INVOICE_ID      = '_solverr_invoice_id';
	public const META_INVOICE_IDS     = '_solverr_invoice_ids';
	public const META_EVENT_IDS       = '_solverr_event_ids';

	private const SECRET_KEY_PATTERN = '/^sk_live_[1-9A-HJ-NP-Za-km-z]{32}$/';
	private const MAX_INVOICE_KEYS   = 5;
	private const LOG_SOURCE         = 'solverr';
	/** An unpaid invoice is reused only while the customer has at least this long to pay it. */
	private const MIN_SECONDS_TO_PAY = 600;

	/** Sets up the gateway and its settings. */
	public function __construct() {
		$this->id                 = self::ID;
		$this->method_title       = __( 'Solverr', 'solverr-woocommerce' );
		$this->method_description = __( 'Customers pay with any supported crypto coin. You receive the coin you chose in your own wallet.', 'solverr-woocommerce' );
		$this->has_fields         = false;
		$this->supports           = array( 'products' );

		$this->init_form_fields();
		$this->init_settings();

		$this->title       = $this->get_option( 'title' );
		$this->description = $this->get_option( 'description' );

		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
	}

	/** Defines the settings fields. */
	public function init_form_fields(): void {
		$this->form_fields = array(
			'enabled'        => array(
				'title'   => __( 'Enable', 'solverr-woocommerce' ),
				'type'    => 'checkbox',
				'label'   => __( 'Accept crypto payments with Solverr', 'solverr-woocommerce' ),
				'default' => 'no',
			),
			'title'          => array(
				'title'       => __( 'Title', 'solverr-woocommerce' ),
				'type'        => 'safe_text',
				'description' => __( 'The name customers see at checkout.', 'solverr-woocommerce' ),
				'default'     => __( 'Solverr — pay with any crypto', 'solverr-woocommerce' ),
				'desc_tip'    => true,
			),
			'description'    => array(
				'title'       => __( 'Description', 'solverr-woocommerce' ),
				'type'        => 'textarea',
				'description' => __( 'The text customers see under the title at checkout.', 'solverr-woocommerce' ),
				'default'     => __( 'Pay with the crypto coin you already hold. After you place the order, you go to a secure Solverr page to finish the payment.', 'solverr-woocommerce' ),
				'desc_tip'    => true,
			),
			'api_base_url'   => array(
				'title'       => __( 'API base URL', 'solverr-woocommerce' ),
				'type'        => 'text',
				'description' => __( 'The address of your Solverr server, such as https://pay.example.com.', 'solverr-woocommerce' ),
				'placeholder' => 'https://pay.example.com',
				'default'     => '',
			),
			'secret_key'     => array(
				'title'       => __( 'API key', 'solverr-woocommerce' ),
				'type'        => 'password',
				'description' => __( 'Create an API key in your Solverr dashboard and paste it here. It starts with sk_live_.', 'solverr-woocommerce' ),
				'default'     => '',
			),
			'webhook_secret' => array(
				'title'       => __( 'Webhook secret', 'solverr-woocommerce' ),
				'type'        => 'password',
				'description' => sprintf(
					/* translators: %s: webhook URL of this store. */
					__( 'In your Solverr dashboard, set the webhook URL to %s, then paste the webhook signing secret here.', 'solverr-woocommerce' ),
					'<code>' . esc_html( self::webhook_url() ) . '</code>'
				),
				'default'     => '',
			),
		);
	}

	/** Accepts an https URL, or http for a local test server, and returns it without a trailing slash.
	    @param string|null $value Submitted value. */
	public function validate_api_base_url_field( $key, $value ): string {
		$url = untrailingslashit( trim( (string) $value ) );
		if ( '' === $url ) {
			return '';
		}

		$parts = wp_parse_url( $url );
		$host  = is_array( $parts ) ? ( $parts['host'] ?? '' ) : '';
		$local = in_array( $host, array( 'localhost', '127.0.0.1', '[::1]' ), true );
		$valid = is_array( $parts )
			&& '' !== $host
			&& empty( $parts['query'] )
			&& empty( $parts['fragment'] )
			&& empty( $parts['user'] )
			&& empty( $parts['pass'] )
			&& ( 'https' === ( $parts['scheme'] ?? '' ) || ( $local && 'http' === ( $parts['scheme'] ?? '' ) ) );

		if ( ! $valid ) {
			WC_Admin_Settings::add_error( __( 'Enter the API base URL as a full https address, such as https://pay.example.com.', 'solverr-woocommerce' ) );
			return (string) $this->get_option( $key );
		}
		return esc_url_raw( $url, array( 'http', 'https' ) );
	}

	/** Accepts a Solverr API key and returns the value to store.
	    @param string|null $value Submitted value. */
	public function validate_secret_key_field( $key, $value ): string {
		$secret = trim( (string) $value );
		if ( '' !== $secret && ! self::is_secret_key( $secret ) ) {
			WC_Admin_Settings::add_error( __( 'The API key must start with sk_live_. Copy it again from your Solverr dashboard.', 'solverr-woocommerce' ) );
			return (string) $this->get_option( $key );
		}
		return $secret;
	}

	/** Accepts the webhook signing secret and returns the value to store.
	    @param string|null $value Submitted value. */
	public function validate_webhook_secret_field( $key, $value ): string {
		$secret = trim( sanitize_text_field( (string) $value ) );
		if ( '' !== $secret && null === Solverr_Webhook_Handler::secret_key( $secret ) ) {
			WC_Admin_Settings::add_error( __( 'The webhook secret must start with whsec_. Copy it again from the Developers page of your Solverr dashboard.', 'solverr-woocommerce' ) );
			return (string) $this->get_option( $key );
		}
		return $secret;
	}

	/** Shows the gateway only when it is configured and the store currency is supported. */
	public function is_available(): bool {
		return parent::is_available() && $this->is_configured() && self::is_store_currency_supported();
	}

	/** Whether the API base URL, a valid API key and a valid webhook secret are all set. */
	public function is_configured(): bool {
		return '' !== $this->get_option( 'api_base_url' )
			&& self::is_secret_key( (string) $this->get_option( 'secret_key' ) )
			&& null !== Solverr_Webhook_Handler::secret_key( (string) $this->get_option( 'webhook_secret' ) );
	}

	/** Webhook signing secret. */
	public function get_webhook_secret(): string {
		return (string) $this->get_option( 'webhook_secret' );
	}

	/** @param int $order_id Order whose invoice is created or reused before redirecting to its checkout page.
	    @return array{result: string, redirect?: string} */
	public function process_payment( $order_id ): array {
		$order = wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order ) {
			return array( 'result' => 'failure' );
		}

		try {
			$invoice = $this->find_open_invoice( $order ) ?? $this->create_invoice( $order );
		} catch ( Solverr_API_Exception $error ) {
			$this->log_error( sprintf( 'Order %d: %s', $order->get_id(), $error->getMessage() ) );
			wc_add_notice( __( 'The crypto payment could not start. Try again in a moment, or choose another payment method.', 'solverr-woocommerce' ), 'error' );
			return array( 'result' => 'failure' );
		}

		return array(
			'result'   => 'success',
			'redirect' => $invoice['checkout_url'],
		);
	}

	/** @return array<string, mixed>|null The order's current invoice when it is for the order's amount and can still be used (see is_usable()), else null.
	    @throws Solverr_API_Exception When Solverr cannot be reached. */
	private function find_open_invoice( WC_Order $order ): ?array {
		$invoice_id = (string) $order->get_meta( self::META_INVOICE_ID );
		if ( '' === $invoice_id ) {
			return null;
		}

		try {
			$invoice = $this->checked_invoice( $this->api_client()->get_invoice( $invoice_id ) );
		} catch ( Solverr_API_Exception $error ) {
			if ( 404 === $error->status ) {
				return null;
			}
			throw $error;
		}

		$matches = $invoice['amount'] === self::order_amount( $order ) && $invoice['currency'] === $order->get_currency();
		return $matches && self::is_usable( $invoice ) ? $invoice : null;
	}

	/** @param array<string, mixed> $invoice Checked invoice; usable while a payment is under way or complete, or the customer still has MIN_SECONDS_TO_PAY.
	    Underpaid, failed, refunded and expired invoices are never used again. */
	private static function is_usable( array $invoice ): bool {
		if ( in_array( $invoice['status'], array( 'detected', 'processing', 'paid' ), true ) ) {
			return true;
		}
		$expires_at = strtotime( $invoice['expires_at'] );
		return in_array( $invoice['status'], array( 'created', 'awaiting_payment' ), true )
			&& false !== $expires_at
			&& $expires_at - time() >= self::MIN_SECONDS_TO_PAY;
	}

	/** Creates an invoice for the order and records its id. Keys are `wc-order-<id>` plus a counter after the first: a retry gets the same invoice,
	    a changed total a new one, and a replayed invoice that is no longer usable moves to the next key. Throws Solverr_API_Exception if none is created. */
	private function create_invoice( WC_Order $order ): array {
		$invoice_ids = self::order_invoice_ids( $order );
		$params      = $this->invoice_params( $order );
		$first       = count( $invoice_ids ) + 1;

		for ( $number = $first; $number < $first + self::MAX_INVOICE_KEYS; $number++ ) {
			$idempotency_key = 1 === $number ? 'wc-order-' . $order->get_id() : sprintf( 'wc-order-%d-%d', $order->get_id(), $number );
			try {
				$invoice = $this->checked_invoice( $this->api_client()->create_invoice( $params, $idempotency_key ) );
			} catch ( Solverr_API_Exception $error ) {
				/** The billing email is optional and WordPress accepts addresses the API refuses, so the same key is tried once without it. */
				if ( 400 === $error->status && 'customer_email' === $error->param && isset( $params['customer_email'] ) ) {
					unset( $params['customer_email'] );
					--$number;
					continue;
				}
				/** Only a key used with a different request has no Retry-After; a key still being processed fails here. */
				if ( 'idempotency_conflict' === $error->error_type && 0 === $error->retry_after ) {
					continue;
				}
				throw $error;
			}
			if ( ! self::is_usable( $invoice ) ) {
				continue;
			}

			$invoice_ids[] = $invoice['id'];
			$order->update_meta_data( self::META_INVOICE_ID, $invoice['id'] );
			$order->update_meta_data( self::META_INVOICE_IDS, array_values( array_unique( $invoice_ids ) ) );
			$order->save();
			/* translators: %s: Solverr invoice id. */
			$order->add_order_note( sprintf( __( 'Solverr invoice %s created.', 'solverr-woocommerce' ), $invoice['id'] ) );
			return $invoice;
		}

		throw new Solverr_API_Exception( 'No unused idempotency key was left for this order.' );
	}

	/** Invoice fields for an order.
	    @return array<string, mixed> */
	private function invoice_params( WC_Order $order ): array {
		$params = array(
			'amount'       => self::order_amount( $order ),
			'currency'     => $order->get_currency(),
			'order_id'     => (string) $order->get_order_number(),
			'description'  => mb_substr(
				sprintf(
					/* translators: 1: order number, 2: store name. */
					__( 'Order %1$s from %2$s', 'solverr-woocommerce' ),
					$order->get_order_number(),
					wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES )
				),
				0,
				500
			),
			'redirect_url' => $this->get_return_url( $order ),
			'metadata'     => array( 'wc_order_id' => (string) $order->get_id() ),
		);

		$email = $order->get_billing_email();
		if ( is_email( $email ) ) {
			$params['customer_email'] = $email;
		}
		return $params;
	}

	/** @param array<string, mixed> $invoice Invoice response, returned unchanged once the fields this plugin relies on are checked.
	    @throws Solverr_API_Exception When a field is missing or malformed. */
	private function checked_invoice( array $invoice ): array {
		foreach ( array( 'id', 'status', 'amount', 'currency', 'checkout_url', 'expires_at' ) as $field ) {
			if ( ! is_string( $invoice[ $field ] ?? null ) ) {
				throw new Solverr_API_Exception( sprintf( 'The invoice response has no %s.', $field ) );
			}
		}
		if ( '' === esc_url_raw( $invoice['checkout_url'], array( 'http', 'https' ) ) ) {
			throw new Solverr_API_Exception( 'The invoice response has an invalid checkout_url.' );
		}
		return $invoice;
	}

	/** API client built from the saved settings. */
	private function api_client(): Solverr_API_Client {
		return new Solverr_API_Client( (string) $this->get_option( 'api_base_url' ), (string) $this->get_option( 'secret_key' ) );
	}

	/** Writes an error to the WooCommerce log. Messages never contain keys or secrets. */
	private function log_error( string $message ): void {
		wc_get_logger()->error( $message, array( 'source' => self::LOG_SOURCE ) );
	}

	/** Order total as a decimal string with 2 decimals, such as "25.00". */
	public static function order_amount( WC_Order $order ): string {
		return wc_format_decimal( $order->get_total(), 2 );
	}

	/** Every invoice id issued for the order, oldest first.
	    @return string[] */
	public static function order_invoice_ids( WC_Order $order ): array {
		$ids = $order->get_meta( self::META_INVOICE_IDS );
		return is_array( $ids ) ? array_values( array_filter( $ids, 'is_string' ) ) : array();
	}

	/** Whether the value has the shape of a Solverr API key (sk_live_ and 32 base58 characters). */
	public static function is_secret_key( #[\SensitiveParameter] string $secret ): bool {
		return 1 === preg_match( self::SECRET_KEY_PATTERN, $secret );
	}

	/** Whether Solverr accepts the store currency. */
	public static function is_store_currency_supported(): bool {
		return in_array( get_woocommerce_currency(), self::SUPPORTED_CURRENCIES, true );
	}

	/** URL Solverr sends webhooks to. */
	public static function webhook_url(): string {
		return WC()->api_request_url( self::ID );
	}

	/** Warns store managers when the gateway is enabled but cannot be shown at checkout. */
	public static function render_admin_notices(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		$settings = get_option( 'woocommerce_' . self::ID . '_settings', array() );
		if ( ! is_array( $settings ) || 'yes' !== ( $settings['enabled'] ?? 'no' ) ) {
			return;
		}

		$settings_url = admin_url( 'admin.php?page=wc-settings&tab=checkout&section=' . self::ID );
		if ( ! self::is_store_currency_supported() ) {
			$message = sprintf(
				/* translators: %s: store currency code. */
				__( 'Solverr is turned on but is hidden at checkout, because your store currency is %s. Solverr accepts USD, EUR and INR. Change the currency in WooCommerce settings, or turn Solverr off.', 'solverr-woocommerce' ),
				get_woocommerce_currency()
			);
		} elseif ( empty( $settings['api_base_url'] ) || ! self::is_secret_key( (string) ( $settings['secret_key'] ?? '' ) ) || null === Solverr_Webhook_Handler::secret_key( (string) ( $settings['webhook_secret'] ?? '' ) ) ) {
			$message = __( 'Solverr is turned on but is hidden at checkout until you enter the API base URL, an API key that starts with sk_live_, and a webhook secret that starts with whsec_.', 'solverr-woocommerce' );
		} else {
			return;
		}

		printf(
			'<div class="notice notice-warning"><p>%1$s <a href="%2$s">%3$s</a></p></div>',
			esc_html( $message ),
			esc_url( $settings_url ),
			esc_html__( 'Open Solverr settings', 'solverr-woocommerce' )
		);
	}
}
