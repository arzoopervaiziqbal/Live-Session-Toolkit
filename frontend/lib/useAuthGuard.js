"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, getUser, clearToken, clearUser, tokenIsValid } from "./api";

/**
 * Host-only route guard. `ready` stays false until the check has run so pages
 * don't flash unauthenticated content before redirecting.
 */
export function useAuthGuard(loginPath = "/host/login") {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken();
    const storedUser = getUser();
    if (!token || !storedUser || !tokenIsValid(token)) {
      clearToken();
      clearUser();
      router.replace(loginPath);
      return;
    }
    setUser(storedUser);
    setReady(true);
  }, [loginPath, router]);

  function logout() {
    clearToken();
    clearUser();
    router.replace(loginPath);
  }

  return { user, logout, ready };
}
