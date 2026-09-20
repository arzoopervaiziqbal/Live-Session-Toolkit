"use client";
import { useRouter } from "next/navigation";
import AuthForm from "../../../components/AuthForm";
import { useLang } from "../../../contexts/LangContext";
import { api, setToken, setUser } from "../../../lib/api";

export default function HostAuthPage() {
  const router = useRouter();
  const { t } = useLang();

  async function handleSubmit(mode, { name, email, password, confirmPassword }) {
    const data =
      mode === "login"
        ? await api.hostLogin({ email, password })
        : await api.hostRegister({ name, email, password, confirmPassword });

    setToken("host", data.token);
    setUser("host", data.user);
    router.push("/host/dashboard");
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <AuthForm title={t.asHost} onSubmit={handleSubmit} />
    </main>
  );
}
