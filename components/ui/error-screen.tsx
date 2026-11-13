import { LogoMark } from "@/components/brand/logo";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type ErrorLink = { href: string; label: string };

/** The server log reference Next.js attaches to errors from Server Components; the error message itself is never shown. */
export function errorDigest(error: unknown): string | null {
  return typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string" ? error.digest : null;
}

/** Friendly error card: logo, heading, a plain explanation, "Try again" and one way out.
    `fullPage` centers it on its own screen for routes outside the dashboard shell. */
export function ErrorScreen({
  title,
  message,
  error,
  onRetry,
  link,
  fullPage = false,
}: {
  title: string;
  message: string;
  error?: unknown;
  onRetry?: () => void;
  link: ErrorLink;
  fullPage?: boolean;
}) {
  const digest = errorDigest(error);
  const card = (
    <Card className="flex w-full max-w-[480px] animate-fade-in flex-col items-center gap-5 px-5 py-8 text-center sm:px-8 sm:py-10">
      <LogoMark className="size-10" />
      <div role="alert" className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="text-body text-muted">{message}</p>
      </div>
      <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:justify-center">
        {onRetry ? (
          <Button onClick={onRetry} className="w-full sm:w-auto">
            Try again
          </Button>
        ) : null}
        <ButtonLink href={link.href} variant={onRetry ? "secondary" : "primary"} className="w-full sm:w-auto">
          {link.label}
        </ButtonLink>
      </div>
      {digest ? (
        <p className="break-all text-meta text-muted">
          Reference code: <span className="font-mono">{digest}</span>
        </p>
      ) : null}
    </Card>
  );

  /** In the dashboard shell the card fills the content area's height (screen minus shell padding and phone top bar) to sit in the middle. */
  if (!fullPage) return <div className="flex min-h-[calc(100dvh-6.5rem)] items-center justify-center py-6 md:min-h-[calc(100dvh-2rem)]">{card}</div>;
  /** On its own screen it is the page's main content, so assistive technology can jump to it. */
  return <main className="flex min-h-dvh flex-1 items-center justify-center px-4 py-8">{card}</main>;
}
