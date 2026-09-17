"use client";
import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import SettingsMenu from "../../../components/SettingsMenu";
import { api, getGuestId } from "../../../lib/api";

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  // Prefill from a shared link (?code=ABC123) and remember the name so a
  // participant rejoining after a disconnect doesn't retype it.
  useEffect(() => {
    const fromUrl = params.get("code");
    if (fromUrl) setCode(fromUrl.toUpperCase());
    const saved = localStorage.getItem("lst_display_name");
    if (saved) setName(saved);
  }, [params]);

  // Confirm the code exists before asking for a name — faster failure.
  useEffect(() => {
    const clean = code.replace(/[^A-Za-z0-9]/g, "");
    if (clean.length < 6) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await api.lookupSession(clean);
        if (!cancelled) {
          setPreview(data.session);
          setError(null);
        }
      } catch {
        if (!cancelled) setPreview(null);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code]);

  async function join(e) {
    e.preventDefault();
    if (busy) return;

    const cleanCode = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!cleanCode) return setError("Enter the session code.");
    if (!name.trim()) return setError("Enter your name so the host can see your score.");

    setBusy(true);
    setError(null);
    try {
      const data = await api.joinSession({
        code: cleanCode,
        name: name.trim(),
        guestId: getGuestId(),
      });

      localStorage.setItem("lst_display_name", name.trim());
      localStorage.setItem(
        `lst_participant_${data.session.id}`,
        JSON.stringify({ participantId: data.participant.id, sessionId: data.session.id })
      );

      router.replace(`/participant/room/${data.session.sessionCode}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex justify-between items-center px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center font-display font-bold text-sm">
            L
          </div>
          <div className="font-display font-bold">LiveHub</div>
        </Link>
        <SettingsMenu />
      </div>

      <div className="flex-1 flex items-center justify-center px-6 pb-16">
        <form onSubmit={join} className="card p-6 w-full max-w-sm">
          <h1 className="font-display text-xl font-bold mb-1">Join a session</h1>
          <p className="text-xs text-gray-500 mb-5">No account needed.</p>

          {error && <div className="form-error mb-4">{error}</div>}

          <div className="mb-3.5">
            <label className="label" htmlFor="code">
              Session code
            </label>
            <input
              id="code"
              className="field font-mono tracking-[0.3em] text-center text-lg uppercase"
              value={code}
              maxLength={12}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            {preview && (
              <div className="text-xs text-live mt-1.5 text-center">
                {preview.title}
                {preview.status === "ended" && " — this session has ended"}
              </div>
            )}
          </div>

          <div className="mb-5">
            <label className="label" htmlFor="name">
              Your name
            </label>
            <input
              id="name"
              className="field"
              value={name}
              maxLength={60}
              placeholder="e.g. Sara K."
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Joining..." : "Join session"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinForm />
    </Suspense>
  );
}
