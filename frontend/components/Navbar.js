"use client";
import Link from "next/link";
import SettingsMenu from "./SettingsMenu";

export default function Navbar({ userName, onLogout, right = null }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E1E1DC] dark:border-[#2A2E52] bg-white dark:bg-[#171A33]">
      <Link href="/" className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center font-display font-bold text-sm">
          L
        </div>
        <div>
          <div className="font-display font-bold text-sm leading-tight">LiveHub</div>
          <div className="text-[11px] text-gray-500 leading-tight">AI live session toolkit</div>
        </div>
      </Link>

      <div className="flex items-center gap-3">
        {right}
        {userName && (
          <div className="flex items-center gap-2 bg-[#F5F5F2] dark:bg-[#0E1020] border border-[#E1E1DC] dark:border-[#2A2E52] rounded-lg px-2.5 py-1.5 text-sm">
            <span className="max-w-[120px] truncate">{userName}</span>
            <button onClick={onLogout} title="Log out" className="text-gray-400 text-xs hover:text-red-500">
              ⎋
            </button>
          </div>
        )}
        <SettingsMenu />
      </div>
    </div>
  );
}
