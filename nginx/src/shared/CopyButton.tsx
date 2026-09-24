import { useState } from "react";

// A button that copies text and shows a confirmation for a moment. Shared by
// every "Copy" action: the JSON viewer's toolbar and the per-code-block copy
// buttons in rendered Markdown and notebooks.
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  delayMs = 1000,
  className = "btn",
}: {
  text: () => string;
  label?: string;
  copiedLabel?: string;
  delayMs?: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      onClick={() => {
        navigator.clipboard.writeText(text());
        setCopied(true);
        setTimeout(() => setCopied(false), delayMs);
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
