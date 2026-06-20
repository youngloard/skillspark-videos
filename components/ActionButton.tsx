"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

type ActionResult = { ok: boolean; error?: string };

type Props = {
  /** A server action returning the project's `R` shape (`{ ok, error? }`). */
  action: () => Promise<ActionResult>;
  /** Toast shown on `{ ok: true }`. Omit for silent success (e.g. reorders). */
  successMessage?: string;
  /** Native confirm() the user must accept before the action fires. */
  confirm?: string;
  /** Client-side navigation after success (toast survives — provider is in the layout). */
  redirectTo?: string;
  className?: string;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
  children: React.ReactNode;
};

/**
 * Button equivalent of <ActionForm> for actions that take no form fields —
 * deletes, reorders, toggles, refreshes. Surfaces a toast on success/failure
 * instead of throwing to the error boundary. Runs inside a transition so the
 * action's own `revalidatePath` refreshes the server tree in place.
 */
export default function ActionButton({
  action,
  successMessage,
  confirm,
  redirectTo,
  className,
  title,
  ariaLabel,
  disabled,
  children,
}: Props) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      className={className}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled || pending}
      data-pending={pending ? "true" : undefined}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          try {
            const r = await action();
            if (r.ok) {
              if (successMessage) toast.success(successMessage);
              if (redirectTo) {
                router.push(redirectTo);
              } else {
                router.refresh();
              }
            } else {
              toast.error(r.error || "Something went wrong.");
            }
          } catch {
            toast.error("Something went wrong.");
          }
        });
      }}
    >
      {children}
    </button>
  );
}
