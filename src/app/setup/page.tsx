"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupPage() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [viewKey, setViewKey] = useState("");
  const [restoreHeight, setRestoreHeight] = useState("0");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);

    try {
      const response = await fetch("/api/wallet/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, viewKey, restoreHeight, description }),
      });
      const data = await response.json();

      if (response.status === 401) {
        setStatus({ kind: "error", text: "Please sign in first." });
        return;
      }
      if (!response.ok) throw new Error(data.error ?? "Setup failed");

      setStatus({ kind: "ok", text: `Watch-only wallet ready: ${data.wallet.address}` });
      router.refresh();
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Setup failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Set up a watch-only wallet</h1>
      <p>
        Paste your wallet&apos;s primary address and private view key. Your spend key is
        never requested or stored — the app can only watch incoming payments.
      </p>

      <form className="card form" onSubmit={handleSubmit}>
        <label>
          Primary address
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="4..."
            required
          />
        </label>

        <label>
          Private view key
          <input
            value={viewKey}
            onChange={(event) => setViewKey(event.target.value)}
            placeholder="64 hex characters"
            required
          />
        </label>

        <label>
          Restore height <span>(0 to scan from the start)</span>
          <input
            type="number"
            min="0"
            value={restoreHeight}
            onChange={(event) => setRestoreHeight(event.target.value)}
          />
        </label>

        <label>
          Description <span>(optional)</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="e.g. Storefront"
          />
        </label>

        <button type="submit" disabled={busy}>
          {busy ? "Setting up..." : "Create watch-only wallet"}
        </button>

        {status && <p className={status.kind}>{status.text}</p>}
      </form>
    </main>
  );
}
