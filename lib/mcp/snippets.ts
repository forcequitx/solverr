export const SNIPPET_KINDS = ["html", "react", "node", "webhook"] as const;
type SnippetKind = (typeof SNIPPET_KINDS)[number];

/** Copy-paste integration code with the merchant's real app URL and, for html and react, the payment link id `link` filled in. */
export function integrationSnippet(kind: SnippetKind, appUrl: string, link: string): string {
  switch (kind) {
    case "html":
      return `<!-- Pay button: opens the full Solverr checkout page (add data-solverr-mode="overlay" for a popup instead) -->\n<script src="${appUrl}/embed.js" async></script>\n<button data-solverr-link="${link}">Pay with crypto</button>`;
    case "react":
      return `// npm install solverr-react\nimport { PayButton } from "solverr-react";\n\nexport function Checkout() {\n  return <PayButton baseUrl="${appUrl}" link="${link}">Pay with crypto</PayButton>;\n}`;
    case "node":
      return `// npm install solverr-node\nimport { Solverr } from "solverr-node";\n\nconst solverr = new Solverr({ apiKey: process.env.SOLVERR_SECRET_KEY, baseUrl: "${appUrl}" });\n\nconst invoice = await solverr.invoices.create({ amount: "25.00", currency: "USD", order_id: "1042", redirect_url: "https://shop.example/thanks" });\n// Redirect the customer to invoice.checkout_url`;
    case "webhook":
      return `// Next.js route: app/api/webhooks/solverr/route.ts\nimport { Webhooks, WebhookVerificationError } from "solverr-node";\n\nconst webhooks = new Webhooks();\n\nexport async function POST(request: Request) {\n  const body = await request.text();\n  let event;\n  try {\n    event = webhooks.verify(body, request.headers, process.env.SOLVERR_WEBHOOK_SECRET!);\n  } catch (error) {\n    if (error instanceof WebhookVerificationError) return new Response(error.message, { status: 400 });\n    throw error;\n  }\n  if (event.type === "invoice.paid") {\n    // Mark event.data.invoice.order_id as paid in your database.\n  }\n  return new Response(null, { status: 204 });\n}`;
  }
}
