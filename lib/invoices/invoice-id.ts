/** An invoice ID as `newId("inv")` creates it, such as `inv_7Hk2…`; it also finds one inside longer text, such as an alert message. */
export const INVOICE_ID = /\binv_[A-Za-z0-9]+/;

/** Whether the whole value is an invoice ID. */
export const isInvoiceId = (value: string) => INVOICE_ID.exec(value)?.[0] === value;
