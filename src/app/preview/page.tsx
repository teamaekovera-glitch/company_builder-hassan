import type { Metadata } from "next";
import PreviewPage from "./preview-view";

export const metadata: Metadata = {
  title: "Operator UI preview — Autonomous Company Builder",
  description: "Static fixture render of every operator-UI surface and state",
};

export default function Page() {
  return <PreviewPage />;
}
