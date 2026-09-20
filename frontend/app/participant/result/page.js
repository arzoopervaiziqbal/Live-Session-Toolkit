"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "../../../components/Navbar";

export default function ResultPage() {
  const router = useRouter();
  const [result, setResult] = useState(null);
  const [guestName, setGuestName] = useState("");

  useEffect(() => {
    const raw = sessionStorage.getItem("sp_last_result");
    if (!raw) {
      router.replace("/participant/join");
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      setResult(parsed);
    } catch {
      router.replace("/participant/join");
      return;
    }

    const name = sessionStorage.getItem("sp_guest_name");
    if (name) setGuestName(name);
  }, [router]);

  if (!result) return null;

  const displayName = result.participantName || guestName || "Student";
  const percentage =
    result.percentage !== null && result.percentage !== undefined
      ? result.percentage
      : result.scored > 0
      ? Math.round((result.correct / result.scored) * 100)
      : 0;

  return (
    <main className="min-h-screen pb-16 bg-[#FAFAF9] dark:bg-[#080915] flex flex-col">
      <Navbar userName={displayName} logoutLabel={undefined} />

      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-12">
        <div className="w-full max-w-md">
          {/* Card Container */}
          <div className="card p-8 sm:p-10 text-center shadow-lg border border-[#E1E1DC] dark:border-[#2A2E52] bg-white dark:bg-[#12142B] rounded-2xl relative overflow-hidden">
            {/* Top Accent Bar */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-primary via-indigo-500 to-emerald-500" />

            {/* Quiz Completion Icon */}
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto mb-4 text-2xl shadow-xs">
              ✓
            </div>

            {/* Header */}
            <h1 className="font-display text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
              Quiz Completed
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mb-6">
              {result.activityTitle || "Assessment"} • {displayName}
            </p>

            {/* Marks Box */}
            {result.hasScore ? (
              <div className="p-6 rounded-2xl bg-[#F8F8F5] dark:bg-[#1B1E3F]/50 border border-[#EBEBE6] dark:border-[#2A2E52] mb-6">
                <div className="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-2">
                  Your Marks
                </div>

                <div className="flex items-baseline justify-center gap-2 mb-2">
                  <span className="font-display text-6xl sm:text-7xl font-extrabold text-primary tracking-tight">
                    {result.correct}
                  </span>
                  <span className="text-2xl sm:text-3xl font-bold text-gray-400">
                    / {result.scored}
                  </span>
                </div>

                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary font-bold text-sm">
                  <span>Score:</span>
                  <span>{percentage}%</span>
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-[#F8F8F5] dark:bg-[#1B1E3F]/50 border border-[#EBEBE6] dark:border-[#2A2E52] mb-6">
                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Thank you! Your quiz answers have been recorded.
                </div>
              </div>
            )}

            {/* Return / Join Action */}
            <div className="pt-2">
              <button
                type="button"
                className="btn-primary w-full py-3 text-sm font-semibold shadow-sm flex items-center justify-center gap-2"
                onClick={() => router.push("/participant/join")}
              >
                <span>🚀</span> Done / Join Another Session
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
