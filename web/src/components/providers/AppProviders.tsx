"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { subscribeMockDb } from "@/services/mocks/mockDb";
import { useAppStore } from "@/stores/useAppStore";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 1,
          },
        },
      })
  );

  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  useEffect(() => {
    const unsubLocal = subscribeMockDb(() => {
      queryClient.invalidateQueries();
    });

    let ch: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        ch = new BroadcastChannel("goodly_mock_sync");
        ch.onmessage = () => {
          queryClient.invalidateQueries();
        };
      } catch {
        // ignore
      }
    }

    return () => {
      unsubLocal();
      ch?.close();
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}

      {/* Global Toast Container */}
      <div
        aria-live="polite"
        className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-[#E8E3D5] bg-white px-4 py-3 shadow-lg text-sm text-[#1E1F1C]"
          >
            {toast.type === "success" && (
              <CheckCircle2 className="w-4 h-4 text-[#2E7D32] mt-0.5 shrink-0" />
            )}
            {toast.type === "error" && (
              <AlertCircle className="w-4 h-4 text-[#C62828] mt-0.5 shrink-0" />
            )}
            {toast.type === "info" && (
              <Info className="w-4 h-4 text-[#5F8E63] mt-0.5 shrink-0" />
            )}
            <span className="flex-1 leading-snug">{toast.text}</span>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="text-[#8A8880] hover:text-[#1E1F1C]"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </QueryClientProvider>
  );
}
