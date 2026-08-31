/**
 * One notification system for the whole application.
 *
 * Screens previously each rendered their own inline status panel, which is why
 * a successful export announced itself differently from a failed sync. Anything
 * that finishes, succeeds or fails now says so the same way, in the same place.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import {
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastViewport,
} from "./primitives";

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds. Errors stay until dismissed unless told otherwise. */
  duration?: number;
}

interface ToastRecord extends Required<Pick<ToastOptions, "title" | "tone">> {
  id: number;
  description?: string | undefined;
  duration: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
} as const;

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const toast = useCallback((options: ToastOptions) => {
    const tone = options.tone ?? "info";
    setToasts((current) => [
      ...current,
      {
        // Errors deserve to be read, so they persist far longer by default.
        id: (current.at(-1)?.id ?? 0) + 1,
        title: options.title,
        description: options.description,
        tone,
        duration: options.duration ?? (tone === "error" ? 12_000 : 5000),
      },
    ]);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) =>
        toast({ title, tone: "success", ...(description ? { description } : {}) }),
      error: (title, description) =>
        toast({ title, tone: "error", ...(description ? { description } : {}) }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastProvider swipeDirection="right">
        {children}
        {toasts.map((item) => {
          const Icon = ICONS[item.tone];
          return (
            <ToastRoot
              key={item.id}
              className="toast"
              data-tone={item.tone}
              duration={item.duration}
              onOpenChange={(open) => {
                if (!open) setToasts((current) => current.filter((t) => t.id !== item.id));
              }}
            >
              <Icon size={15} className="toast__icon" aria-hidden="true" />
              <div className="grow">
                <ToastTitle className="toast__title">{item.title}</ToastTitle>
                {item.description ? (
                  <ToastDescription className="toast__description">
                    {item.description}
                  </ToastDescription>
                ) : null}
              </div>
            </ToastRoot>
          );
        })}
        <ToastViewport className="toast-viewport" />
      </ToastProvider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastHost");
  return context;
}
