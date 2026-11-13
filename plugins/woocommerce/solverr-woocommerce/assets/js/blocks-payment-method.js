/** Registers the Solverr payment method in the WooCommerce Cart and Checkout blocks. */
( function () {
	const { registerPaymentMethod } = window.wc.wcBlocksRegistry;
	const { getSetting } = window.wc.wcSettings;
	const { createElement } = window.wp.element;
	const { decodeEntities } = window.wp.htmlEntities;
	const { __ } = window.wp.i18n;

	const settings = getSetting( 'solverr_data', {} );
	const title =
		decodeEntities( settings.title || '' ) ||
		__( 'Solverr — pay with any crypto', 'solverr-woocommerce' );
	const description = decodeEntities( settings.description || '' );

	const Label = ( props ) =>
		createElement( props.components.PaymentMethodLabel, { text: title } );
	const Content = () => ( description ? createElement( 'p', null, description ) : null );

	registerPaymentMethod( {
		name: 'solverr',
		label: createElement( Label ),
		content: createElement( Content ),
		edit: createElement( Content ),
		canMakePayment: () => true,
		ariaLabel: title,
		supports: { features: settings.supports || [ 'products' ] },
	} );
} )();
