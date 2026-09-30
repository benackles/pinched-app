"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Toasts sit at the top so they never cover the bottom tab bar or a thumb. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-center"
      offset={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
      mobileOffset={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-2xl !border !border-border !bg-card !text-foreground !shadow-lift !font-sans",
          description: "!text-muted-foreground",
          actionButton:
            "!h-9 !rounded-full !bg-primary-strong !px-4 !text-sm !font-semibold !text-primary-foreground",
          cancelButton: "!h-9 !rounded-full !bg-secondary !px-4 !text-sm !text-secondary-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
