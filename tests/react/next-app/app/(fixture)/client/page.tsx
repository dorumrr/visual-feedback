"use client";

import { useEffect, useState } from "react";
import { Feedback } from "visual-feedback/react";

export default function Page() {
  const [mounted, setMounted] = useState(true);
  const [left, setLeft] = useState(false);
  // The test changes props while the modal dialog keeps the page's buttons out of reach.
  useEffect(() => {
    Object.assign(window, { setLeft, setMounted, sent: [] });
  }, []);
  return (
    <main>
      <button type="button" onClick={() => setMounted(!mounted)}>
        Toggle widget
      </button>
      <button type="button" onClick={() => setLeft(!left)}>
        Toggle side
      </button>
      {mounted && (
        <Feedback
          // A new function on each render: the send must use the latest one.
          onSubmit={async (report) => {
            (window as unknown as { sent: string[] }).sent.push(
              `${left ? "left" : "right"} ${report.note}`,
            );
          }}
          {...(left
            ? { position: "bottom-left", strings: { trigger: "Left feedback" } }
            : { shortcut: "Alt+Shift+F" })}
        />
      )}
    </main>
  );
}
