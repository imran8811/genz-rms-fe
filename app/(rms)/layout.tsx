import AppShell from "@/components/AppShell";
import CounterAlerts from "@/components/CounterAlerts";
import { RequireAuth } from "@/lib/auth";

export default function ModuleLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
      {/* Top-right alert column: the online-order alarm (chime + card) and a
          toast when the kitchen marks an order ready. */}
      <CounterAlerts />
    </RequireAuth>
  );
}
