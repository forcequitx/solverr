<?php
/** Solverr payment method for the Cart and Checkout blocks.
    @package Solverr\WooCommerce */

defined( 'ABSPATH' ) || exit;

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

/** Registers the Solverr gateway with the block-based checkout. */
final class Solverr_Blocks_Payment_Method extends AbstractPaymentMethodType {

	private const SCRIPT_HANDLE = 'solverr-blocks-payment-method';

	/** Payment method name; matches the gateway id.
	    @var string */
	protected $name = WC_Gateway_Solverr::ID;

	/** Loads the gateway settings. */
	public function initialize() {
		$settings       = get_option( 'woocommerce_' . WC_Gateway_Solverr::ID . '_settings', array() );
		$this->settings = is_array( $settings ) ? $settings : array();
	}

	/** Whether the gateway can be shown at checkout. */
	public function is_active() {
		$gateway = $this->gateway();
		return null !== $gateway && $gateway->is_available();
	}

	/** Script that registers the payment method in the checkout block.
	    @return string[] */
	public function get_payment_method_script_handles() {
		wp_register_script(
			self::SCRIPT_HANDLE,
			SOLVERR_WC_URL . 'assets/js/blocks-payment-method.js',
			array( 'wc-blocks-registry', 'wc-settings', 'wp-element', 'wp-html-entities', 'wp-i18n' ),
			SOLVERR_WC_VERSION,
			true
		);
		wp_set_script_translations( self::SCRIPT_HANDLE, 'solverr-woocommerce' );
		return array( self::SCRIPT_HANDLE );
	}

	/** Settings passed to the script as `solverr_data`.
	    @return array<string, mixed> */
	public function get_payment_method_data() {
		$gateway = $this->gateway();
		return array(
			'title'       => $this->get_setting( 'title' ),
			'description' => $this->get_setting( 'description' ),
			'supports'    => null === $gateway ? array() : array_values( array_filter( $gateway->supports, array( $gateway, 'supports' ) ) ),
		);
	}

	/** Registered gateway instance. */
	private function gateway(): ?WC_Gateway_Solverr {
		$gateway = WC()->payment_gateways()->payment_gateways()[ WC_Gateway_Solverr::ID ] ?? null;
		return $gateway instanceof WC_Gateway_Solverr ? $gateway : null;
	}
}
