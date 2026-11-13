<?php
/**
 * Plugin Name:          Solverr for WooCommerce
 * Description:          Accept payments in any crypto coin through Solverr. You receive the coin you chose in your own wallet.
 * Version:              0.1.0
 * Requires at least:    6.5
 * Requires PHP:         8.3
 * Requires Plugins:     woocommerce
 * Author:               Solverr
 * License:              GPL-2.0-or-later
 * License URI:          https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:          solverr-woocommerce
 * WC requires at least: 8.0
 * WC tested up to:      11.2
 *
 * @package Solverr\WooCommerce
 */

defined( 'ABSPATH' ) || exit;

define( 'SOLVERR_WC_VERSION', '0.1.0' );
define( 'SOLVERR_WC_FILE', __FILE__ );
define( 'SOLVERR_WC_PATH', plugin_dir_path( __FILE__ ) );
define( 'SOLVERR_WC_URL', plugin_dir_url( __FILE__ ) );

add_action(
	'before_woocommerce_init',
	static function (): void {
		if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', SOLVERR_WC_FILE, true );
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', SOLVERR_WC_FILE, true );
		}
	}
);

add_action(
	'plugins_loaded',
	static function (): void {
		if ( ! class_exists( 'WC_Payment_Gateway' ) ) {
			return;
		}

		require_once SOLVERR_WC_PATH . 'includes/class-solverr-api-client.php';
		require_once SOLVERR_WC_PATH . 'includes/class-solverr-webhook-handler.php';
		require_once SOLVERR_WC_PATH . 'includes/class-wc-gateway-solverr.php';

		add_filter(
			'woocommerce_payment_gateways',
			static function ( array $gateways ): array {
				$gateways[] = WC_Gateway_Solverr::class;
				return $gateways;
			}
		);

		add_action( 'woocommerce_api_' . WC_Gateway_Solverr::ID, array( Solverr_Webhook_Handler::class, 'handle_request' ) );
		add_action( 'admin_notices', array( WC_Gateway_Solverr::class, 'render_admin_notices' ) );
	}
);

add_action(
	'woocommerce_blocks_loaded',
	static function (): void {
		if ( ! class_exists( \Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType::class ) ) {
			return;
		}

		require_once SOLVERR_WC_PATH . 'includes/class-solverr-blocks-payment-method.php';

		add_action(
			'woocommerce_blocks_payment_method_type_registration',
			static function ( \Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry $registry ): void {
				$registry->register( new Solverr_Blocks_Payment_Method() );
			}
		);
	}
);

add_filter(
	'plugin_action_links_' . plugin_basename( SOLVERR_WC_FILE ),
	static function ( array $links ): array {
		$url = admin_url( 'admin.php?page=wc-settings&tab=checkout&section=solverr' );
		array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'solverr-woocommerce' ) . '</a>' );
		return $links;
	}
);
