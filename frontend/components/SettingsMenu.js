"use client";
import { useState } from "react";
import { useTheme } from "../contexts/ThemeContext";

export default function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  return (
    <div className="relative">
      <button className="btn-secondary" onClick={() => setOpen((o) => !o)} aria-label="Settings">
        ⚙
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-56 card p-4 shadow-lg z-20">
            <div className="flex justify-between items-center mb-3">
              <span className="font-display text-sm font-semibold">Appearance</span>
              <button onClick={() => setOpen(false)} className="text-xs text-gray-400">
                ✕
              </button>
            </div>
            <div className="flex bg-[#F5F5F2] dark:bg-[#0E1020] rounded-lg p-1 border border-[#E1E1DC] dark:border-[#2A2E52]">
              {["light", "dark"].map((k) => (
                <button
                  key={k}
                  onClick={() => setTheme(k)}
                  className={`flex-1 text-xs py-2 rounded-md capitalize ${
                    theme === k ? "bg-primary text-white" : "text-gray-500"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
