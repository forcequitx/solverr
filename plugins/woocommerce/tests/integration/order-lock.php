<?php
/** One step of the order lock test, run with `wp eval-file order-lock.php <step>` in a real WordPress; order-lock.sh runs the steps.
    Each step exits 1 with a FAIL line when its check does not hold. Locks taken here are released by the plugin's shutdown function.
    @package Solverr\WooCommerce\Tests */

require '/plugin/includes/class-solverr-webhook-handler.php';

const SOLVERR_TEST_ORDER   = 5;
const SOLVERR_TEST_RELEASE = '_solverr_test_release_holder';

global $wpdb;
$solverr_lock_row = '_solverr_order_lock_' . SOLVERR_TEST_ORDER;

$solverr_lock = static function (): bool {
	return ( new ReflectionMethod( Solverr_Webhook_Handler::class, 'lock_order' ) )->invoke( null, SOLVERR_TEST_ORDER );
};
$solverr_row = static fn() => $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $solverr_lock_row ) );
$solverr_check = static function ( bool $passed, string $message ): void {
	echo ( $passed ? 'ok   ' : 'FAIL ' ), $message, "\n";
	if ( ! $passed ) {
		exit( 1 );
	}
};
/** Seconds on a monotonic clock; Docker Desktop on Windows steps the wall clock that microtime() reads. */
$solverr_now = static fn(): float => hrtime( true ) / 1e9;
/** Polls the database directly, since WordPress caches options per request. */
$solverr_wait_for = static function ( callable $condition, float $seconds ) use ( $solverr_now ): bool {
	$deadline = $solverr_now() + $seconds;
	while ( ! $condition() ) {
		if ( $solverr_now() > $deadline ) {
			return false;
		}
		usleep( 100_000 );
	}
	return true;
};

switch ( $args[0] ?? '' ) {
	case 'hold':
		$solverr_check( $solverr_lock(), 'the first request takes the free lock' );
		$solverr_check(
			$solverr_wait_for( static fn() => null !== $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", SOLVERR_TEST_RELEASE ) ), 60 ),
			'the holder is told to finish'
		);
		break;

	case 'busy':
		$solverr_check( $solverr_wait_for( static fn() => null !== $solverr_row(), 30 ), 'the holder\'s lock row exists' );
		$started = $solverr_now();
		$taken   = $solverr_lock();
		$waited  = $solverr_now() - $started;
		$wpdb->insert( $wpdb->options, array( 'option_name' => SOLVERR_TEST_RELEASE, 'option_value' => '1', 'autoload' => 'no' ) );
		$solverr_check( false === $taken, 'a second request does not get a held lock' );
		$solverr_check( $waited >= 3.0 && $waited < 4.5, sprintf( 'the second request waits 3 s before giving up (waited %.1f s)', $waited ) );
		break;

	case 'free':
		$started = $solverr_now();
		$solverr_check( $solverr_lock(), 'a request after the holder ended takes the lock' );
		$solverr_check( $solverr_now() - $started < 1, 'the released lock is taken without waiting' );
		$solverr_check( null !== $solverr_row(), 'the lock row exists while the request runs' );
		break;

	case 'stale':
		$old = ( time() - 60 ) . ' left-by-a-dead-request';
		$wpdb->insert( $wpdb->options, array( 'option_name' => $solverr_lock_row, 'option_value' => $old, 'autoload' => 'no' ) );
		$started = $solverr_now();
		$solverr_check( $solverr_lock(), 'a lock older than 30 s is taken over' );
		$solverr_check( $solverr_now() - $started < 1, 'the stale lock is taken over without waiting' );
		$now = (int) $solverr_row();
		$solverr_check( $solverr_row() !== $old && abs( time() - $now ) <= 2, 'the taken-over row carries the new holder\'s time' );
		break;

	case 'clean':
		$solverr_left = $wpdb->get_col( $wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( '_solverr_order_lock_' ) . '%' ) );
		$wpdb->delete( $wpdb->options, array( 'option_name' => SOLVERR_TEST_RELEASE ) );
		$solverr_check( array() === $solverr_left, 'no lock rows are left after the requests ended' );
		break;

	default:
		echo "Usage: wp eval-file order-lock.php hold|busy|free|stale|clean\n";
		exit( 2 );
}
