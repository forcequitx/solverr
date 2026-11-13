"use client";

import { useState } from "react";
import { CopyAction } from "@/components/dashboard/copy-buttons";
import { SectionCard } from "@/components/dashboard/section-card";
import { Icon } from "@/components/ui/icon";
import { Segmented } from "@/components/ui/segmented";

type Client = "claude" | "json";

const CLIENTS: { value: Client; label: string }[] = [
  { value: "claude", label: "Claude Code" },
  { value: "json", label: "Other clients" },
];

/** Setup for the remote MCP server, as a Claude Code command or a JSON config, with a placeholder key in place of a real one. */
export function McpSetup({ appUrl }: { appUrl: string }) {
  const [client, setClient] = useState<Client>("claude");
  const endpoint = `${appUrl}/api/mcp`;
  const bearer = "Bearer sk_live_…";
  const snippets: Record<Client, string> = {
    claude: `claude mcp add --transport http solverr ${endpoint} \\\n  --header "Authorization: ${bearer}"`,
    json: JSON.stringify({ mcpServers: { solverr: { url: endpoint, headers: { Authorization: bearer } } } }, null, 2),
  };

  return (
    <SectionCard
      icon="terminal"
      tint="blue"
      title="Checkout from your AI code editor"
      description="Add the Solverr MCP server, then ask your editor to add crypto checkout to your site."
      action={<Segmented role="radiogroup" label="MCP client" options={CLIENTS} value={client} onChange={setClient} />}
    >
      {/** Both snippets share one grid cell, so switching keeps the block at the taller one's height; on phones long lines wrap. */}
      <div className="grid min-w-0 rounded-[14px] border border-line bg-surface-2">
        {(Object.keys(snippets) as Client[]).map((key) => (
          <pre
            key={key}
            aria-hidden={key !== client}
            className={`col-start-1 row-start-1 min-w-0 overflow-x-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5 [overflow-wrap:anywhere] sm:whitespace-pre sm:[overflow-wrap:normal] [scrollbar-width:none] transition-opacity duration-200 motion-reduce:transition-none ${key === client ? "opacity-100" : "invisible opacity-0"}`}
          >
            {snippets[key]}
          </pre>
        ))}
      </div>
      <p className="text-meta text-muted">Replace sk_live_… with one of your API keys. The server acts with the full rights of that key, so keep it private.</p>
      <CopyAction text={snippets[client]} variant="secondary" size="sm" className="mt-auto self-start">
        <Icon name="copy" className="size-4" />
        Copy
      </CopyAction>
    </SectionCard>
  );
}
