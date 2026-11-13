"use client";

import { createContext, useContext, type ReactElement, type ReactNode } from "react";

const BaseUrlContext = createContext<string | undefined>(undefined);

export interface SolverrProviderProps {
  /** Origin of the Solverr app, such as "https://pay.example.com". */
  baseUrl: string;
  children?: ReactNode;
}

/** Sets the Solverr app URL for every PayButton inside it. */
export function SolverrProvider({ baseUrl, children }: SolverrProviderProps): ReactElement {
  return <BaseUrlContext.Provider value={baseUrl}>{children}</BaseUrlContext.Provider>;
}

export function useProvidedBaseUrl(): string | undefined {
  return useContext(BaseUrlContext);
}
