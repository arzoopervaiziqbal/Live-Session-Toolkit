"use client";
import Link from "next/link";
import SettingsMenu from "../components/SettingsMenu";

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex justify-between items-center px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center font-display font-bold text-sm">
            L
          </div>
          <div className="font-display font-bold">LiveHub</div>
        </div>
        <SettingsMenu />
      </div>

      <div className="flex-1 flex items-center justify-center px-6 pb-16">
        <div className="max-w-md w-full text-center">
          <h1 className="font-display text-3xl font-bold mb-2">One toolkit for every live session</h1>
          <p className="text-sm text-gray-500 mb-8">
            AI turns your notes into a quiz in seconds. Polls, Q&amp;A, and grading all in one place.
          </p>

          <div className="grid gap-3">
            <Link href="/host/login" className="card card-hover p-5 text-left">
              <div className="font-display font-semibold mb-1">I&apos;m a host</div>
              <div className="text-xs text-gray-500">Create a session, generate a quiz, run it live</div>
            </Link>
            <Link href="/participant/join" className="card card-hover p-5 text-left">
              <div className="font-display font-semibold mb-1">I&apos;m joining a session</div>
              <div className="text-xs text-gray-500">No account needed — just your name and the session code</div>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
