import type { Metadata } from "next";

import OperatorDashboard from "./operator-dashboard";

export const metadata: Metadata = {
  title: "Operator dashboard — Autonomous Company Builder",
  description:
    "Configure a run, confirm the pre-flight estimate, and watch the 39-stage pipeline execute live.",
};

export default function Home() {
  return <OperatorDashboard />;
}
