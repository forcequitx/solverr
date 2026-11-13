<?php
/** Removes the plugin settings on uninstall. Invoice ids on past orders are kept as order history.
    @package Solverr\WooCommerce */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'woocommerce_solverr_settings' );

/** Order locks are deleted when their request ends; this clears any left by a request that died. */
global $wpdb;
$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( '_solverr_order_lock_' ) . '%' ) );
