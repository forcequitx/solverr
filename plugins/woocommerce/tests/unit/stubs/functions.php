<?php
/** Minimal stand-ins for the WordPress and WooCommerce functions the plugin calls; the HTTP functions replay responses a test queued,
    and wp_send_json() throws the response so a test can read it.
    @package Solverr\WooCommerce\Tests */

declare(strict_types=1);

/** Returns the text untranslated. */
function __( string $text, string $domain = 'default' ): string {
	return $text;
}

/** As WordPress: strips tags, folds line breaks, tabs and repeated spaces into one space, and trims. */
function sanitize_text_field( mixed $str ): string {
	$text = strip_tags( (string) $str );
	return trim( (string) preg_replace( '/[\r\n\t ]+/', ' ', $text ) );
}

/** Removes the slashes WordPress adds to request data. */
function wp_unslash( mixed $value ): mixed {
	return is_array( $value ) ? array_map( 'wp_unslash', $value ) : stripslashes( (string) $value );
}

/** As WordPress: the absolute value as a non-negative integer. */
function absint( mixed $maybeint ): int {
	return abs( (int) $maybeint );
}

/** The order a test put in `$GLOBALS['solverr_test_orders']` under `$order_id`, or false as WooCommerce returns for an unknown id. */
function wc_get_order( mixed $order_id ): WC_Order|false {
	return $GLOBALS['solverr_test_orders'][ $order_id ] ?? false;
}

/** WooCommerce's wc_format_decimal() for a fixed number of decimals: number_format() with a dot and no thousands separator. */
function wc_format_decimal( mixed $number, int|false $dp = false ): string {
	return false === $dp ? (string) $number : number_format( (float) $number, $dp, '.', '' );
}

/** Records the notice in `$GLOBALS['solverr_test_notices']` as `[message, type]`. */
function wc_add_notice( string $message, string $notice_type = 'success' ): void {
	$GLOBALS['solverr_test_notices'][] = array( $message, $notice_type );
}

/** One WC_Logger per test, kept in `$GLOBALS['solverr_test_logger']`. */
function wc_get_logger(): WC_Logger {
	return $GLOBALS['solverr_test_logger'] ??= new WC_Logger();
}

/** The value a test put in `$GLOBALS['solverr_test_bloginfo'][ $show ]`; WordPress keeps the site title HTML-escaped. */
function get_bloginfo( string $show = '' ): string {
	return (string) ( $GLOBALS['solverr_test_bloginfo'][ $show ] ?? '' );
}

/** As WordPress: decodes &amp;, &lt;, &gt; and, with ENT_QUOTES, both quote entities. */
function wp_specialchars_decode( string $text, int|string $quote_style = ENT_NOQUOTES ): string {
	return htmlspecialchars_decode( $text, (int) $quote_style );
}

/** The address when it is a valid email address, else false. */
function is_email( string $email ): string|false {
	return false === filter_var( $email, FILTER_VALIDATE_EMAIL ) ? false : $email;
}

/** The URL when its scheme is one of `$protocols`, else an empty string as WordPress returns for a refused URL. */
function esc_url_raw( string $url, ?array $protocols = null ): string {
	return in_array( parse_url( $url, PHP_URL_SCHEME ), $protocols ?? array( 'http', 'https' ), true ) ? $url : '';
}

/** Throws Solverr_Test_Response with the status and body instead of sending them and ending the request as WordPress does. */
function wp_send_json( mixed $response, ?int $status_code = null, int $flags = 0 ): never {
	throw new Solverr_Test_Response( $status_code ?? 200, $response );
}

/** A random password of `$length` letters and digits, as WordPress returns without special characters. */
function wp_generate_password( int $length = 12, bool $special_chars = true, bool $extra_special_chars = false ): string {
	return substr( bin2hex( random_bytes( $length ) ), 0, $length );
}

/** As WordPress with default flags: json_encode(). */
function wp_json_encode( mixed $value, int $flags = 0, int $depth = 512 ): string|false {
	return json_encode( $value, $flags, $depth );
}

function is_wp_error( mixed $thing ): bool {
	return $thing instanceof WP_Error;
}

/** Records `[url, args]` in `$GLOBALS['solverr_test_requests']` and returns the next response queued in `$GLOBALS['solverr_test_responses']`. */
function wp_remote_request( string $url, array $args = array() ): array|WP_Error {
	$GLOBALS['solverr_test_requests'][] = array( $url, $args );
	if ( empty( $GLOBALS['solverr_test_responses'] ) ) {
		throw new LogicException( 'No response queued for ' . $url );
	}
	return array_shift( $GLOBALS['solverr_test_responses'] );
}

/** As WordPress: the status code, or an empty string for an error or a response without one. */
function wp_remote_retrieve_response_code( array|WP_Error $response ): int|string {
	return is_wp_error( $response ) || ! isset( $response['response']['code'] ) ? '' : (int) $response['response']['code'];
}

function wp_remote_retrieve_body( array|WP_Error $response ): string {
	return is_wp_error( $response ) ? '' : (string) ( $response['body'] ?? '' );
}

/** As WordPress: the header looked up case-insensitively, or an empty string when missing. */
function wp_remote_retrieve_header( array|WP_Error $response, string $header ): array|string {
	return is_wp_error( $response ) ? '' : ( array_change_key_case( $response['headers'] ?? array() )[ strtolower( $header ) ] ?? '' );
}
