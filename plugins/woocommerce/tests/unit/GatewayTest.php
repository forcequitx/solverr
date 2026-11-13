<?php
/** Unit tests for the static helpers of WC_Gateway_Solverr.
    @package Solverr\WooCommerce\Tests */

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class GatewayTest extends TestCase {

	/** @return iterable<string, array{float|string, string}> */
	public static function totals(): iterable {
		yield 'whole number string' => array( '25', '25.00' );
		yield 'one decimal' => array( '10.5', '10.50' );
		yield 'float' => array( 10.5, '10.50' );
		yield 'float sum with binary error' => array( 0.1 + 0.2, '0.30' );
		yield 'large, no thousands separator' => array( '1234567.8', '1234567.80' );
		yield 'zero' => array( 0.0, '0.00' );
	}

	#[DataProvider( 'totals' )]
	public function test_order_amount_is_the_total_with_two_decimals( float|string $total, string $expected ): void {
		self::assertSame( $expected, WC_Gateway_Solverr::order_amount( new WC_Order( 7, $total ) ) );
	}

	public function test_order_invoice_ids_keeps_only_strings_in_order(): void {
		$order = new WC_Order();
		self::assertSame( array(), WC_Gateway_Solverr::order_invoice_ids( $order ) );
		$order->update_meta_data( WC_Gateway_Solverr::META_INVOICE_IDS, array( 'inv_1', 5, null, 'inv_2' ) );
		self::assertSame( array( 'inv_1', 'inv_2' ), WC_Gateway_Solverr::order_invoice_ids( $order ) );
		$order->update_meta_data( WC_Gateway_Solverr::META_INVOICE_IDS, 'inv_1' );
		self::assertSame( array(), WC_Gateway_Solverr::order_invoice_ids( $order ) );
	}

	public function test_is_secret_key_accepts_only_live_keys_of_32_base58_characters(): void {
		self::assertTrue( WC_Gateway_Solverr::is_secret_key( 'sk_live_' . str_repeat( 'A1z', 10 ) . 'ab' ) );
		foreach ( array( 'sk_test_' . str_repeat( 'a', 32 ), 'sk_live_' . str_repeat( 'a', 31 ), 'sk_live_' . str_repeat( 'a', 33 ), 'sk_live_' . str_repeat( '0', 32 ), 'sk_live_' . str_repeat( 'l', 32 ), '' ) as $key ) {
			self::assertFalse( WC_Gateway_Solverr::is_secret_key( $key ), $key );
		}
	}
}
