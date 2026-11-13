"use client";

import { createOpenAPIPage } from "fumadocs-openapi/ui";

/** Endpoint pages: request details on the left, examples in a right column kept in view below the top bar; the page header holds title and description. */
export const OpenAPIPage = createOpenAPIPage({
  content: {
    renderOperationLayout: (slots) => (
      <div className="@container">
        <div className="flex flex-col gap-x-6 gap-y-4 @4xl:flex-row @4xl:items-start">
          <div className="min-w-0 flex-1">
            {slots.apiPlayground}
            {slots.authSchemes}
            {slots.parameters}
            {slots.body}
            {slots.responses}
            {slots.callbacks}
          </div>
          <div className="@4xl:sticky @4xl:top-24 @4xl:flex @4xl:max-h-[calc(100dvh-7rem)] @4xl:w-[400px] @4xl:flex-col">{slots.apiExample}</div>
        </div>
      </div>
    ),
  },
});
