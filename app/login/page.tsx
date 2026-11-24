import LoginForm from "@/app/components/LoginForm";
import { getAllowedEmailDomain } from "@/lib/email-policy";
import { isGoogleOAuthEnabled } from "@/lib/google-oauth";

/**
 * El flag de Google y el dominio permitido se resuelven en el servidor y se
 * pasan como props al formulario cliente. Así hay una sola fuente de verdad:
 * la UI no puede mostrar un botón que la API va a rechazar.
 */
function oauthErrorMessage(code: string | undefined, domain: string): string {
  switch (code) {
    case "oauth_disabled":
      return "El acceso con Google está deshabilitado temporalmente";
    case "domain_not_allowed":
      return `Solo se permiten correos @${domain}`;
    case "email_required":
      return "Google no devolvió un correo verificado";
    case "invalid_state":
      return "La sesión de Google expiró. Intenta de nuevo";
    case "config_error":
    case "token_error":
    case "no_code":
    case "server_error":
      return "No se pudo completar el acceso con Google";
    default:
      return "";
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const domain = getAllowedEmailDomain();

  return (
    <LoginForm
      googleOAuthEnabled={isGoogleOAuthEnabled()}
      allowedEmailDomain={domain}
      initialError={oauthErrorMessage(error, domain)}
    />
  );
}
