"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, getUser, clearToken, clearUser, tokenHasRole } from "./api";

// Redirects to the given login path if no token is present for this role.
// Returns { user, logout, ready } — ready is false until the check has run
// so pages can avoid a flash of unauthenticated content.
export function useAuthGuard(role, loginPath) {
  const router = useRouter();
  const [user, setUserState] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken(role);
    const storedUser = getUser(role);
    if (!token || !storedUser || storedUser.role !== role || !tokenHasRole(token, role)) {
      clearToken(role);
      clearUser(role);
      router.replace(loginPath);
      return;
    }
    setUserState(storedUser);
    setReady(true);
  }, [role, loginPath, router]);

  function logout() {
    clearToken(role);
    clearUser(role);
    router.replace(loginPath);
  }

  return { user, logout, ready };
}
