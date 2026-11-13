"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { ConfirmAction } from "@/components/dashboard/confirm-action";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { MiddleEllipsis } from "@/components/dashboard/detail/middle-ellipsis";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Field, FieldAction, Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { InitialsAvatar } from "@/components/ui/icon-box";
import { listItemMotion } from "@/components/ui/motion";
import { SearchSelect } from "@/components/ui/search-select";
import { addTeamMemberAction, removeTeamMemberAction } from "@/lib/merchants/actions/team";

const ROLE_TONES: Record<string, BadgeTone> = { owner: "accent", developer: "info", viewer: "muted" };
const ROLE_OPTIONS = [
  { value: "developer", label: "Developer (can make changes, except owner-only settings)" },
  { value: "viewer", label: "Viewer (read only)" },
];

type Member = { id: string; name: string; role: string };

function MemberItem({ member, delay, canRemove }: { member: Member; delay: number; canRemove: boolean }) {
  const merchantId = useMerchantId();
  const { pending, error, run } = useAction();
  return (
    <m.li {...listItemMotion(delay)} className="flex min-h-[60px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3 last:border-b-0">
      <span className="flex min-w-[12rem] flex-1 items-center gap-3">
        <InitialsAvatar text={member.name} index={delay} />
        <MiddleEllipsis value={member.name} className="flex-1 text-body font-medium" />
        <Badge tone={ROLE_TONES[member.role] ?? "muted"}>
          <span className="capitalize">{member.role}</span>
        </Badge>
      </span>
      {canRemove ? (
        <ConfirmAction
          label="Remove"
          confirmLabel="Remove"
          ariaLabel={`Remove ${member.name}`}
          pending={pending}
          error={error}
          onConfirm={() => run(() => removeTeamMemberAction(merchantId, member.id))}
        />
      ) : null}
    </m.li>
  );
}

export function TeamMembers({ members, isOwner }: { members: Member[]; isOwner: boolean }) {
  const merchantId = useMerchantId();
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<"developer" | "viewer">("developer");
  const { pending, done, error, failed, run } = useAction();
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col">
        <AnimatePresence initial={false}>
          {members.map((member, index) => (
            <MemberItem key={member.id} member={member} delay={index} canRemove={isOwner && member.role !== "owner"} />
          ))}
        </AnimatePresence>
      </ul>
      {isOwner ? (
        <form
          className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-[14px] border border-line p-4 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-start"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => addTeamMemberAction(merchantId, { identifier, role }),
              () => setIdentifier(""),
            );
          }}
        >
          <Field label="Teammate's email or wallet address" htmlFor="member">
            <Input id="member" value={identifier} onChange={(event) => setIdentifier(event.target.value)} spellCheck={false} />
          </Field>
          <Field label="Role" htmlFor="member-role">
            <SearchSelect id="member-role" value={role} options={ROLE_OPTIONS} onChange={(value) => setRole(value as "developer" | "viewer")} />
          </Field>
          <FieldAction>
            <ActionButton type="submit" pending={pending} done={done} doneLabel="Added" failed={failed} disabled={!identifier.trim() && !done}>
              <Icon name="plus" className="size-4" />
              Add
            </ActionButton>
          </FieldAction>
          {error ? <ActionError message={error} className="sm:col-span-3" /> : <p className="text-sm text-muted sm:col-span-3">They must have signed in to Solverr once.</p>}
        </form>
      ) : null}
    </div>
  );
}
