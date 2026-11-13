"use client";

import * as m from "motion/react-m";
import { useState, type CSSProperties } from "react";
import { CodeSnippet } from "@/components/dashboard/code-snippet";
import { Card } from "@/components/ui/card";
import { CardHeading } from "@/components/ui/card-heading";
import { Field, Input } from "@/components/ui/field";
import { EASE_OUT } from "@/components/ui/motion";
import { SearchSelect } from "@/components/ui/search-select";
import { Segmented } from "@/components/ui/segmented";

type Theme = "brand" | "dark" | "light";
type Size = "md" | "lg";
type SnippetKind = "html" | "react";

/** The merchant's own button colors that the HTML snippet embeds, not dashboard theme colors. */
const THEMES: Record<Theme, { background: string; color: string; borderColor: string }> = {
  brand: { background: "#155dfc", color: "#ffffff", borderColor: "#155dfc" },
  dark: { background: "#0a0a0a", color: "#ffffff", borderColor: "#0a0a0a" },
  light: { background: "#ffffff", color: "#0a0a0a", borderColor: "#ebebeb" },
};
/** Corner radius shared by the preview and the HTML snippet. */
const BUTTON_RADIUS = "10px";
const SIZES: Record<Size, { padding: string; fontSize: string }> = { md: { padding: "10px 18px", fontSize: "15px" }, lg: { padding: "14px 24px", fontSize: "17px" } };
const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "brand", label: "Blue" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];
const SIZE_OPTIONS: { value: Size; label: string }[] = [
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
];
const SNIPPET_OPTIONS: { value: SnippetKind; label: string }[] = [
  { value: "html", label: "HTML" },
  { value: "react", label: "React" },
];
const PREVIEW_TRANSITION = { duration: 0.28, ease: EASE_OUT };

function styleString(style: CSSProperties): string {
  return Object.entries(style)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`)
    .join(";");
}

/** Button text as HTML: &, < and > become entities so any text pastes as text. */
const htmlText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Button text as JSX children: text with characters JSX treats specially becomes a string expression. */
const jsxText = (text: string) => (/[{}<>&]/.test(text) ? `{${JSON.stringify(text)}}` : text);

/** Button text, look and size for one payment link, a live preview, and the HTML or React code to paste. */
export function ButtonGenerator({ links, appUrl }: { links: { id: string; title: string }[]; appUrl: string }) {
  const [linkId, setLinkId] = useState(links[0].id);
  const [label, setLabel] = useState("Pay with crypto");
  const [theme, setTheme] = useState<Theme>("brand");
  const [size, setSize] = useState<Size>("md");
  const [snippetKind, setSnippetKind] = useState<SnippetKind>("html");

  const { background, color, borderColor } = THEMES[theme];
  const style: CSSProperties = { background, color, border: `1px solid ${borderColor}`, ...SIZES[size], borderRadius: BUTTON_RADIUS, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" };
  const html = `<script src="${appUrl}/embed.js" async></script>\n<button data-solverr-link="${linkId}" style="${styleString(style)}">${htmlText(label)}</button>`;
  const react = `import { PayButton } from "solverr-react";\n\n// PayButton keeps its own blue look; pass className to style it with your CSS.\n<PayButton baseUrl="${appUrl}" link="${linkId}">${jsxText(label)}</PayButton>`;
  const linkTitle = links.find((link) => link.id === linkId)?.title ?? "";

  return (
    <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
        <CardHeading icon="button" tint="blue" title="Button options" description="The preview and the code update as you change them." />
        <Field label="Payment link" htmlFor="btn-link">
          <SearchSelect id="btn-link" value={linkId} options={links.map((link) => ({ value: link.id, label: link.title }))} onChange={setLinkId} />
        </Field>
        <Field label="Button text" htmlFor="btn-label">
          <Input id="btn-label" value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Look</p>
          <Segmented options={THEME_OPTIONS} value={theme} onChange={setTheme} label="Button look" role="radiogroup" className="w-full" />
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Size</p>
          <Segmented options={SIZE_OPTIONS} value={size} onChange={setSize} label="Button size" role="radiogroup" className="w-full" />
        </div>
      </Card>

      <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
        <Card className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Preview</h2>
            <p className="truncate text-meta text-muted">On your site it opens the full checkout page for {linkTitle}.</p>
          </div>
          {/** Fixed stage height fits the large button, so switching size or look never moves the code below. */}
          <div
            role="img"
            aria-label={`Preview: a ${THEME_OPTIONS.find((option) => option.value === theme)?.label.toLowerCase()} ${size === "lg" ? "large" : "medium"} button that says ${label || "nothing"}.`}
            className="grid h-44 place-items-center overflow-hidden rounded-[16px] border border-line bg-surface-2 bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-[length:16px_16px] px-4"
          >
            <m.span
              initial={false}
              animate={{ backgroundColor: background, color, borderColor, ...SIZES[size] }}
              transition={PREVIEW_TRANSITION}
              className="inline-block max-w-full truncate leading-normal"
              style={{ borderWidth: 1, borderStyle: "solid", borderRadius: BUTTON_RADIUS, fontWeight: 600 }}
            >
              {label || " "}
            </m.span>
          </div>
        </Card>

        <Card className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Code</h2>
              <p className="text-meta text-muted">Paste this where the button should appear on your site.</p>
            </div>
            <Segmented options={SNIPPET_OPTIONS} value={snippetKind} onChange={setSnippetKind} label="Code format" />
          </div>
          {/** The block keeps room for the longer snippet, so switching formats or typing does not move the page. */}
          <CodeSnippet
            title={snippetKind === "html" ? "HTML" : "React (solverr-react)"}
            code={snippetKind === "html" ? html : react}
            minHeight="min-h-[304px] sm:min-h-[206px]"
          />
        </Card>
      </div>
    </div>
  );
}
