"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { site } from "@/lib/site";

const convex = new ConvexReactClient(site.convexUrl);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthProvider client={convex}>
      <ToastProvider>{children}</ToastProvider>
    </ConvexAuthProvider>
  );
}
