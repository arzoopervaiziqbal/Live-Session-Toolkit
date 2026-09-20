"use client";
import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Navbar from "../../../components/Navbar";
import { useLang } from "../../../contexts/LangContext";
import { api } from "../../../lib/api";

function getOrCreateGuestId() {
  let id = sessionStorage.getItem("sp_guest_id");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("sp_guest_id", id);
  }
  return id;
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinPageInner />
    </Suspense>
  );
}

function JoinPageInner() {
  const { t } = useLang();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const prefill = searchParams.get("code");
    if (prefill) setCode(prefill);
    // Restore name from this browser tab if already set
    const savedName = sessionStorage.getItem("sp_guest_name");
    if (savedName) setName(savedName);
  }, [searchParams]);

  async function handleFind() {
    let inputName = name.trim();
    let inputCode = code.trim();

    // Smart detection: if code field is empty, but name field contains a code (e.g. 8-char hex or URL or UUID)
    if (!inputCode && inputName && (inputName.length === 8 || inputName.includes("code=") || inputName.length >= 32)) {
      inputCode = inputName;
      inputName = sessionStorage.getItem("sp_guest_name") || "Guest";
      setCode(inputCode);
      setName(inputName);
    }

    if (!inputName) {
      inputName = "Guest";
    }

    let cleanCode = inputCode;
    if (cleanCode.includes("code=")) {
      try {
        const u = new URL(cleanCode.startsWith("http") ? cleanCode : `http://dummy.com/${cleanCode}`);
        const c = u.searchParams.get("code");
        if (c) cleanCode = c.trim();
      } catch (_) {}
    }
    if (cleanCode.includes("/")) {
      const parts = cleanCode.split("/").filter(Boolean);
      cleanCode = parts[parts.length - 1].split("?")[0];
    }
    cleanCode = cleanCode.replace(/^#/, "").trim();

    if (!cleanCode) {
      setError("Please enter the session code (e.g. 62c4e730).");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const guestId = getOrCreateGuestId();
      sessionStorage.setItem("sp_guest_name", inputName);
      const data = await api.joinByCode(cleanCode, guestId, inputName);
      const officialCode = data.activity?.linkId || cleanCode;
      router.push(`/participant/attempt/${officialCode}`);
    } catch (err) {
      setError(err.body?.error || "No live session with that code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen">
      <Navbar userName={name || undefined} logoutLabel={undefined} />

      <div className="max-w-sm mx-auto px-6 py-16">
        <h1 className="font-display text-2xl font-bold mb-2 text-center">{t.join_title}</h1>
        <p className="text-xs text-gray-500 mb-6 text-center">Enter your name and the session code to join</p>

        <div className="space-y-4">
          <div>
            <label className="label block mb-1.5 font-medium">Your Name</label>
            <input
              className="field"
              placeholder="e.g. Alex"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
            />
          </div>

          <div>
            <label className="label block mb-1.5 font-medium">Session Code</label>
            <input
              className={`field font-mono text-center tracking-wider text-base font-bold ${error ? "field-error" : ""}`}
              value={code}
              aria-invalid={!!error}
              onChange={(e) => { setCode(e.target.value); setError(""); }}
              placeholder="e.g. 62c4e730"
            />
          </div>

          {error && (
            <div className="error-text text-center text-xs" role="alert">
              {error}
            </div>
          )}

          <button className="btn-primary w-full py-2.5 mt-2" onClick={handleFind} disabled={loading}>
            {loading ? "Finding session…" : t.join_btn}
          </button>
        </div>
      </div>
    </main>
  );
}
