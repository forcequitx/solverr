import { createElement, Fragment, type ReactNode } from "react";

const PLACEHOLDER = /\{(\w+)\}/g;

/** Replaces `{name}` placeholders in a message with the given values; unknown placeholders stay as written. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(PLACEHOLDER, (match, key: string) => (Object.hasOwn(values, key) ? String(values[key]) : match));
}

/** Like `format`, but values may be React elements, such as bold text or a link inside a sentence. */
export function formatNodes(template: string, values: Record<string, ReactNode>): ReactNode[] {
  return template
    .split(PLACEHOLDER)
    .map((part, index) => (index % 2 === 0 ? part : createElement(Fragment, { key: index }, Object.hasOwn(values, part) ? values[part] : `{${part}}`)));
}
