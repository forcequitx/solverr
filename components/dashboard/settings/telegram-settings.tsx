"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmAction } from "@/components/dashboard/confirm-action";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { CopyAction } from "@/components/dashboard/copy-buttons";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { InitialsAvatar } from "@/components/ui/icon-box";
import { EXPAND_MOTION, listItemMotion } from "@/components/ui/motion";
import { createTelegramCodeAction, disconnectTelegramAction } from "@/lib/merchants/actions/telegram";
import { CONNECT_CODE_MINUTES, CONNECT_CODE_TTL_MS } from "@/lib/telegram/connect-code";

type Chat = { id: string; chatId: string };

/** How often the chat list is read again while a connect code is open. */
const CHAT_REFRESH_MS = 5_000;

function ChatItem({ chat, delay, editable }: { chat: Chat; delay: number; editable: boolean }) {
  const merchantId = useMerchantId();
  const { pending, error, run } = useAction();
  return (
    <m.li {...listItemMotion(delay)} className="flex min-h-[60px] items-center gap-3 border-b border-line py-3 last:border-b-0">
      <InitialsAvatar icon="send" index={delay} firstTint="blue" />
      <span className="min-w-0 flex-1 truncate font-mono text-body">Chat {chat.chatId}</span>
      {editable ? (
        <ConfirmAction
          label="Disconnect"
          confirmLabel="Disconnect"
          ariaLabel={`Disconnect chat ${chat.chatId}`}
          pending={pending}
          error={error}
          onConfirm={() => run(() => disconnectTelegramAction(merchantId, chat.id))}
        />
      ) : null}
    </m.li>
  );
}

export function TelegramSettings({ chats, enabled, editable }: { chats: Chat[]; enabled: boolean; editable: boolean }) {
  /** `chats` is how many chats were connected when the code was made, so a new one closes the code. */
  const [code, setCode] = useState<{ code: string; bot: string | null; chats: number } | null>(null);
  const merchantId = useMerchantId();
  const { pending, error, failed, run } = useAction();
  const router = useRouter();

  if (code && chats.length > code.chats) setCode(null);

  /** While a code is open, the chat list is read again every few seconds; the code closes when it expires. */
  useEffect(() => {
    if (!code) return;
    const refresh = setInterval(() => router.refresh(), CHAT_REFRESH_MS);
    const expire = setTimeout(() => setCode(null), CONNECT_CODE_TTL_MS);
    return () => {
      clearInterval(refresh);
      clearTimeout(expire);
    };
  }, [code, router]);

  if (!enabled) return <p className="text-meta text-muted">The Telegram bot is not available yet.</p>;

  return (
    <div className="flex flex-col gap-4">
      {chats.length > 0 ? (
        <ul className="flex flex-col">
          <AnimatePresence initial={false}>
            {chats.map((chat, index) => (
              <ChatItem key={chat.id} chat={chat} delay={index} editable={editable} />
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="grid min-h-[60px] place-items-center rounded-[16px] border border-dashed border-line px-6 text-center text-meta text-muted">No chats connected.</p>
      )}

      <AnimatePresence initial={false} mode="wait">
        {code ? (
          <m.div key="code" {...EXPAND_MOTION} className="overflow-hidden">
            <div className="flex flex-col gap-3 rounded-[14px] bg-surface-2 p-4 text-body">
              <p>
                Open{" "}
                {code.bot ? (
                  <a className="font-medium text-accent-text hover:underline" href={`https://t.me/${code.bot}?start=${code.code}`} target="_blank" rel="noreferrer">
                    @{code.bot}
                  </a>
                ) : (
                  "the bot"
                )}{" "}
                in Telegram and send <span className="font-mono font-semibold">/connect {code.code}</span>. The code works once, for {CONNECT_CODE_MINUTES} minutes.
              </p>
              <div className="flex flex-wrap gap-2">
                <CopyAction text={`/connect ${code.code}`} variant="secondary" size="sm">
                  <Icon name="copy" className="size-4" />
                  Copy command
                </CopyAction>
                <Button variant="ghost" size="sm" onClick={() => setCode(null)}>
                  Done
                </Button>
              </div>
            </div>
          </m.div>
        ) : editable ? (
          <m.div key="connect" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-start gap-2">
            <ActionButton
              variant="secondary"
              size="sm"
              pending={pending}
              failed={failed}
              onClick={() =>
                run(
                  () => createTelegramCodeAction(merchantId),
                  (result) => setCode({ code: result.code, bot: result.bot, chats: chats.length }),
                )
              }
            >
              <Icon name="send" className="size-4" />
              Connect a Telegram chat
            </ActionButton>
            <ActionError message={error} />
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
