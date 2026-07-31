import type { Metadata } from "next";
import { AgentChat } from "@/components/agent/AgentChat";

export const metadata: Metadata = {
  title: "Yihao.AI — Live AI VC Agent · Creekstone Ventures",
  description:
    "Talk with Yihao.AI, Creekstone Ventures' live AI VC agent for founders.",
};

export default function AgentPage() {
  return <AgentChat />;
}
