import { Body, Button, Container, Head, Heading, Html, Preview, render, Section, Text } from "react-email";
import type { ReactNode } from "react";
import { formatAmount, formatUtcDateTime } from "@/lib/format";

const styles = {
  body: { backgroundColor: "#f7f7f7", fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif", color: "#0a0a0a" },
  container: { margin: "32px auto", padding: "28px", maxWidth: "480px", backgroundColor: "#ffffff", border: "1px solid #ebebeb", borderRadius: "22px" },
  heading: { fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif", fontSize: "22px", fontWeight: 600, margin: "0 0 12px" },
  text: { fontSize: "15px", lineHeight: "24px", color: "#0a0a0a", margin: "0 0 12px" },
  muted: { fontSize: "13px", lineHeight: "20px", color: "#6b6b6b", margin: "16px 0 0" },
  button: { backgroundColor: "#155dfc", color: "#ffffff", padding: "12px 20px", borderRadius: "10px", fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif", fontWeight: 600, textDecoration: "none" },
};

function Layout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>{children}</Container>
      </Body>
    </Html>
  );
}

type RenderedEmail = { subject: string; html: string; text: string };

async function rendered(subject: string, element: ReactNode): Promise<RenderedEmail> {
  return { subject, html: await render(element), text: await render(element, { plainText: true }) };
}

export function magicLinkEmail(url: string): Promise<RenderedEmail> {
  return rendered(
    "Your Solverr sign-in link",
    <Layout preview="Sign in to Solverr">
      <Heading style={styles.heading}>Sign in to Solverr</Heading>
      <Text style={styles.text}>Use the button below to sign in. The link works once and expires in 5 minutes.</Text>
      <Section>
        <Button href={url} style={styles.button}>
          Sign in
        </Button>
      </Section>
      <Text style={styles.muted}>If you did not ask to sign in, you can ignore this email.</Text>
    </Layout>,
  );
}

export function receiptEmail(input: { merchantName: string; amount: string; currency: string; receiptUrl: string }): Promise<RenderedEmail> {
  const amount = formatAmount(input.amount);
  return rendered(
    `Your payment to ${input.merchantName}`,
    <Layout preview={`Your payment of ${amount} ${input.currency} to ${input.merchantName} is complete`}>
      <Heading style={styles.heading}>Payment complete</Heading>
      <Text style={styles.text}>
        Your payment of {amount} {input.currency} to {input.merchantName} is complete. Your receipt lists the blockchain transactions so you can check the payment yourself.
      </Text>
      <Section>
        <Button href={input.receiptUrl} style={styles.button}>
          View receipt
        </Button>
      </Section>
    </Layout>,
  );
}

export function invoiceEmail(input: { merchantName: string; amount: string; currency: string; payUrl: string; expiresAt: Date }): Promise<RenderedEmail> {
  const amount = formatAmount(input.amount);
  return rendered(
    `${input.merchantName}: payment due`,
    <Layout preview={`${amount} ${input.currency} is due to ${input.merchantName}`}>
      <Heading style={styles.heading}>Your payment is due</Heading>
      <Text style={styles.text}>
        Your {input.merchantName} subscription payment of {amount} {input.currency} is due today. On the payment page, you choose the coin and network you pay with. The link works until {formatUtcDateTime(input.expiresAt)}.
      </Text>
      <Section>
        <Button href={input.payUrl} style={styles.button}>
          Pay now
        </Button>
      </Section>
    </Layout>,
  );
}

export function alertEmail(input: { merchantName: string; message: string; dashboardUrl: string }): Promise<RenderedEmail> {
  return rendered(
    `Solverr alert for ${input.merchantName}`,
    <Layout preview={input.message}>
      <Heading style={styles.heading}>New alert for {input.merchantName}</Heading>
      <Text style={styles.text}>{input.message}</Text>
      <Section>
        <Button href={input.dashboardUrl} style={styles.button}>
          Open dashboard
        </Button>
      </Section>
    </Layout>,
  );
}
