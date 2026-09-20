"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ParticipantRegisterRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/participant/login");
  }, [router]);
  return null;
}
