/**
 * Interactive primitives, built on Radix.
 *
 * Radix supplies behaviour only — focus trapping, escape handling,
 * outside-click dismissal, ARIA wiring, scroll locking, return-focus. All of
 * that was previously hand-rolled here and was subtly wrong: the drawer let Tab
 * escape to the page behind it, one dialog had no Escape key at all, and the
 * sync popover never closed when you clicked away.
 *
 * The styling is entirely ours; Radix imposes none.
 */
import { Dialog, Popover, Toast as RadixToast, Tooltip } from "radix-ui";
import { X } from "lucide-react";
import { type ReactNode } from "react";

/* ============================ drawer ============================ */

/**
 * A right-hand panel for inspecting or editing one thing.
 *
 * Modal: focus is trapped inside, the page behind is inert, Escape closes, and
 * focus returns to whatever opened it.
 */
export function Drawer({
  title,
  description,
  open = true,
  onClose,
  children,
  headerExtra,
}: {
  title: string;
  description?: string;
  open?: boolean;
  onClose: () => void;
  children: ReactNode;
  headerExtra?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="drawer" aria-describedby={undefined}>
          <div className="drawer__header">
            <div className="stack stack--xs">
              <Dialog.Title className="drawer__title">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-xs muted">{description}</Dialog.Description>
              ) : null}
              {headerExtra}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="button button--subtle button--icon"
                aria-label="Close"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <div className="drawer__body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ============================ modal ============================ */

/** A centred dialog for a decision that needs an answer before continuing. */
export function Modal({
  title,
  description,
  open = true,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  open?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="modal">
          <div className="modal__header">
            <Dialog.Title className="modal__title">{title}</Dialog.Title>
            {description ? (
              <Dialog.Description className="modal__description">{description}</Dialog.Description>
            ) : null}
          </div>
          <div className="modal__body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const ModalClose = Dialog.Close;

/* ============================ popover ============================ */

/** Anchored transient content. Closes on Escape and on click outside. */
export function PopoverPanel({
  trigger,
  children,
  align = "end",
  width,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  width?: number;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="popover"
          align={align}
          sideOffset={6}
          collisionPadding={8}
          style={width ? { width } : undefined}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export const PopoverClose = Popover.Close;

/* ============================ tooltip ============================ */

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </Tooltip.Provider>
  );
}

/**
 * A tooltip is a convenience, never the only label. Icon-only controls carry
 * their own aria-label so a screen reader never depends on hover.
 */
export function WithTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tag" sideOffset={5}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/* ============================ toast ============================ */

export const ToastProvider = RadixToast.Provider;
export const ToastRoot = RadixToast.Root;
export const ToastTitle = RadixToast.Title;
export const ToastDescription = RadixToast.Description;
export const ToastViewport = RadixToast.Viewport;
