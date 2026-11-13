<?php
/** Loads PHPUnit, the WordPress stand-ins and the plugin classes without WordPress.
    @package Solverr\WooCommerce\Tests */

declare(strict_types=1);

define( 'ABSPATH', __DIR__ . '/' );
define( 'SOLVERR_WC_VERSION', '0.0.0-test' );

require dirname( __DIR__ ) . '/vendor/autoload.php';
require __DIR__ . '/stubs/functions.php';
require __DIR__ . '/stubs/classes.php';

$solverr_includes = dirname( __DIR__, 2 ) . '/solverr-woocommerce/includes/';
require $solverr_includes . 'class-solverr-api-client.php';
require $solverr_includes . 'class-solverr-webhook-handler.php';
require $solverr_includes . 'class-wc-gateway-solverr.php';
