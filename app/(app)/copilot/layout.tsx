"use client";

import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

/**
 * Scoped to this route only — CopilotKitProvider does not wrap the root
 * layout, so every existing page keeps its current behavior untouched.
 */
export default function CopilotLayout({ children }: { children: React.ReactNode }) {
  return <CopilotKitProvider runtimeUrl="/api/copilotkit">{children}</CopilotKitProvider>;
}
