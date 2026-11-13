import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { FIAT_AMOUNT_PATTERN } from "@/lib/money";

export const INVOICE_LIFETIME_SECONDS = { default: 3600, min: 900, max: 86_400 } as const;

/** Where the checkout sends the customer after paying; only http and https, so it can never run script. */
export const redirectUrlSchema = z
  .url({ protocol: /^https?$/, error: "redirect_url must be an http or https URL." })
  .max(2048, "redirect_url can be at most 2048 characters.");

/** A positive fiat decimal string; `example` appears in error messages, `required` is the missing-value message, other types get the format one. */
export function fiatAmountSchema({ example = "25.00", required }: { example?: string; required?: string } = {}) {
  const format = `amount must be a decimal string with up to 2 decimals, such as "${example}".`;
  return z
    .string({ error: (issue) => (issue.input === undefined && required ? required : format) })
    .regex(FIAT_AMOUNT_PATTERN, format)
    .refine((value) => Number(value) > 0, "amount must be greater than 0.");
}

export const currencySchema = z.enum(SUPPORTED_CURRENCIES, { error: "currency must be USD, EUR or INR." });

export const createInvoiceSchema = z.strictObject({
  amount: fiatAmountSchema({ required: 'amount is required, as a decimal string such as "25.00".' }),
  currency: currencySchema,
  order_id: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(500).optional(),
  redirect_url: redirectUrlSchema.optional(),
  customer_email: z.email({ error: "customer_email must be a valid email address." }).optional(),
  metadata: z
    .record(z.string().max(40), z.string({ error: "metadata values must be strings." }).max(500, "metadata values can be at most 500 characters."), {
      error: (issue) => (issue.code === "invalid_key" ? "metadata keys can be at most 40 characters." : undefined),
    })
    .refine((value) => Object.keys(value).length <= 20, "metadata can have at most 20 keys.")
    .optional(),
  expires_in: z
    .number()
    .int()
    .min(INVOICE_LIFETIME_SECONDS.min, "expires_in must be at least 900 seconds (15 minutes).")
    .max(INVOICE_LIFETIME_SECONDS.max, "expires_in must be at most 86400 seconds (24 hours).")
    .optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
