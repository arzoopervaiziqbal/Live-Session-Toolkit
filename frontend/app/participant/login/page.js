"use client";
import { useRouter } from "next/navigation";
import AuthForm from "../../../components/AuthForm";
import { useLang } from "../../../contexts/LangContext";
import { api, setToken, setUser } from "../../../lib/api";

export default function ParticipantAuthPage() {
  const router = useRouter();
  const { t } = useLang();

  async function handleSubmit(mode, { name, email, password, confirmPassword }) {
    const data =
      mode === "login"
        ? await api.participantLogin({ email, password })
        : await api.participantRegister({ name, email, password, confirmPassword });

    setToken("participant", data.token);
    setUser("participant", data.user);
    router.push("/participant/join");
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <AuthForm title={t.asParticipant} onSubmit={handleSubmit} />
    </main>
  );
}
