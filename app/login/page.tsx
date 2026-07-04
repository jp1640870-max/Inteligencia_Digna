"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint =
        mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login"
          ? { email, password }
          : { email, password, name: name || email.split("@")[0] };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error de autenticación");
        return;
      }

      router.push("/");
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = () => {
    console.log("[Login] Google click → /api/auth/google");
    window.location.href = "/api/auth/google";
  };

  return (
    <main className="h-screen flex items-center justify-center bg-[#030812] text-white">
      <div className="w-full max-w-sm bg-[#0d131d] p-8 rounded-2xl border border-[#202938]">
        <div className="text-center mb-8">
          <img src="/logo.png" className="w-16 h-16 mx-auto" />
          <h1 className="text-2xl font-bold text-green-400 mt-4">
            Inteligencia Digna
          </h1>
          <p className="text-gray-400 text-sm">
            {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre (opcional)"
              className="w-full p-3 bg-[#121824] rounded-xl outline-none"
            />
          )}

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Correo electrónico"
            required
            className="w-full p-3 bg-[#121824] rounded-xl outline-none"
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña"
            required
            className="w-full p-3 bg-[#121824] rounded-xl outline-none"
          />

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 p-3 rounded-xl font-bold hover:bg-green-500 transition disabled:opacity-50"
          >
            {loading
              ? "Cargando..."
              : mode === "login"
              ? "Iniciar sesión"
              : "Crear cuenta"}
          </button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#202938]" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-[#0d131d] px-2 text-gray-400">o</span>
          </div>
        </div>

        <button
          onClick={handleGoogle}
          className="w-full p-3 rounded-xl border border-[#202938] hover:bg-[#121824] transition flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continuar con Google
        </button>

        <p className="text-center text-sm text-gray-400 mt-6">
          {mode === "login" ? (
            <>
              ¿No tienes cuenta?{" "}
              <button
                onClick={() => setMode("register")}
                className="text-green-400 hover:underline"
              >
                Registrarse
              </button>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{" "}
              <button
                onClick={() => setMode("login")}
                className="text-green-400 hover:underline"
              >
                Iniciar sesión
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
