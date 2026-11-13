"use client";

import { createContext, useContext, type InputHTMLAttributes, type ReactNode } from "react";

const control =
  "h-11 w-full rounded-control border border-line bg-surface px-3.5 text-field text-fg placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

/** The field around an input: its control id, its label's id, the id of the hint or error shown under it, and whether that is an error. */
const FieldContext = createContext<{ controlId?: string; labelId?: string; describedBy?: string; invalid: boolean }>({ invalid: false });

/** The id of the `Field` label for the control `id`, for parts of the control (such as a popup list) that need the same name. */
export function useFieldLabelId(id: string | undefined): string | undefined {
  const field = useContext(FieldContext);
  return id !== undefined && id === field.controlId ? field.labelId : undefined;
}

/** A text input; inside a `Field` whose `htmlFor` is this input's id, it is described by the field's hint or error. */
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const field = useContext(FieldContext);
  const described = props.id !== undefined && props.id === field.controlId;
  return (
    <input
      className={`${control} ${className}`}
      aria-describedby={described ? field.describedBy : undefined}
      aria-invalid={described && field.invalid ? true : undefined}
      {...props}
    />
  );
}

const SPACER_FROM = { sm: "hidden text-sm sm:block", xl: "hidden text-sm xl:block" } as const;

/** A button in a row of fields, kept level with their controls by an empty label line.
    `from` is the breakpoint where the fields sit in a row; below it the button stacks under them with no gap. */
export function FieldAction({ children, from = "sm" }: { children: ReactNode; from?: keyof typeof SPACER_FROM }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span aria-hidden="true" className={SPACER_FROM[from]}>
        &nbsp;
      </span>
      {children}
    </div>
  );
}

/** `announce` reads the error out as soon as it appears; meant for an answer from the server, not for checks that change while typing. */
export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  announce = false,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
  announce?: boolean;
}) {
  /** The note under the control gets an id from `htmlFor`, so the control can point to it. */
  const noteId = htmlFor && (error || hint) ? `${htmlFor}-${error ? "error" : "hint"}` : undefined;
  const labelId = htmlFor ? `${htmlFor}-label` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label id={labelId} htmlFor={htmlFor} className="text-sm font-medium text-fg">
        {label}
      </label>
      <FieldContext value={{ controlId: htmlFor, labelId, describedBy: noteId, invalid: !!error }}>{children}</FieldContext>
      {error ? (
        <p id={noteId} role={announce ? "alert" : undefined} className="text-meta text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-meta text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
