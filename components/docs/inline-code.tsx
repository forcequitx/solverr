import { Fragment } from "react";

/** Plain text with Markdown `code` spans shown as inline code, for page descriptions written in frontmatter or the API spec. */
export function TextWithCode({ text }: { text: string }) {
  /** Splitting on backtick pairs puts the code spans at the odd indexes. */
  return text.split(/`([^`]+)`/).map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className="rounded-[6px] bg-surface-2 px-1 font-mono text-[0.9em] text-fg">
        {part}
      </code>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

/** The same text without Markdown code marks, for places that take plain text such as meta descriptions. */
export function plainText(text: string): string {
  return text.replace(/`([^`]+)`/g, "$1");
}
