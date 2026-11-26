import type { KbSource } from "@/types";

/**
 * Construcción determinista de una solicitud de escalamiento simulada.
 *
 * El modelo no decide los campos ni ejecuta herramientas: el backend toma el
 * chat ya persistido y aplica reglas fijas. El resultado es solo una vista
 * previa; no se persiste ni se envía a ningún sistema externo.
 */

export type EscalationMessage = {
  role: "user" | "ai";
  text?: string;
  kbSources?: KbSource[];
};

export type EscalationUser = {
  name?: string | null;
  email: string;
};

export type SupportEscalationRequest = {
  summary: string;
  description: string;
  category: string;
  priority: "baja" | "media" | "alta";
  reported_by: string;
  troubleshooting_steps: string[];
  escalation_reason: string;
};

const MAX_SUMMARY = 180;
const MAX_DESCRIPTION = 4000;
const MAX_REASON = 500;

function cleanText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

const CATEGORY_RULES: Array<{ category: string; patterns: RegExp }> = [
  {
    category: "acceso_y_credenciales",
    patterns: /contrase[nñ]a|password|acceso|acceder|login|iniciar sesi[oó]n|cuenta|bloquead|permiso|credencial/i,
  },
  {
    category: "correo_electronico",
    patterns: /correo|email|outlook|bandeja|mensajer[ií]a/i,
  },
  {
    category: "red_y_conectividad",
    patterns: /red|internet|wifi|wi-fi|vpn|conexi[oó]n|conectar|servidor|dns|ip\b/i,
  },
  {
    category: "hardware_y_dispositivos",
    patterns: /laptop|equipo|computadora|monitor|teclado|mouse|impresora|disco|bater[ií]a|dispositivo|hardware/i,
  },
  {
    category: "software_y_aplicaciones",
    patterns: /aplicaci[oó]n|programa|software|actualizar|instalar|windows|office|autocad|excel|error|no abre|no funciona/i,
  },
];

const URGENT_PATTERN =
  /urgente|cr[ií]tico|no puedo trabajar|bloquead|ca[ií]do|producci[oó]n|todos los usuarios|toda el [áa]rea|inmediato/i;
const ISSUE_PATTERN =
  /error|falla|problema|no funciona|no abre|no puedo|incidencia|aviso|fallo/i;

export function categorizeSupportIssue(text: string): string {
  const normalized = cleanText(text);
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.test(normalized)) return rule.category;
  }
  return "soporte_general";
}

type EscalationRequestPriority = SupportEscalationRequest["priority"];

export function prioritizeSupportIssue(text: string): EscalationRequestPriority {
  const normalized = cleanText(text);
  if (URGENT_PATTERN.test(normalized)) return "alta";
  if (ISSUE_PATTERN.test(normalized)) return "media";
  return "baja";
}

function uniqueDocumentNames(messages: EscalationMessage[]): string[] {
  const names = new Set<string>();
  for (const message of messages) {
    for (const source of message.kbSources || []) {
      const name = cleanText(source.filename);
      if (name) names.add(name);
    }
  }
  return [...names];
}

export function buildSupportEscalation({
  user,
  messages,
  reason,
}: {
  user: EscalationUser;
  messages: EscalationMessage[];
  reason?: string | null;
}): SupportEscalationRequest {
  const userText = messages
    .filter((message) => message.role === "user")
    .map((message) => cleanText(message.text))
    .filter(Boolean);

  const firstUserText = userText[0] || "El usuario no describió el problema por escrito.";
  const allText = messages.map((message) => cleanText(message.text)).filter(Boolean).join(" ");
  const documents = uniqueDocumentNames(messages);

  const excerpt = messages
    .slice(-8)
    .map((message) => {
      const label = message.role === "user" ? "Usuario" : "Soporte Técnico";
      const text = cleanText(message.text);
      return text ? `${label}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  const troubleshootingSteps = [
    "Se revisó el historial de la conversación y los datos reportados por el usuario.",
  ];

  if (documents.length > 0) {
    troubleshootingSteps.push(
      `Se consultaron ${documents.length} documento(s) de la base de conocimiento: ${documents.join(", ")}.`,
    );
  } else {
    troubleshootingSteps.push(
      "No se recuperaron documentos relevantes en la base de conocimiento.",
    );
  }

  if (messages.some((message) => message.role === "ai")) {
    troubleshootingSteps.push(
      "Se intentó dar una respuesta con la información disponible sin inventar evidencia.",
    );
  }

  const displayName = cleanText(user.name);
  const reportedBy = displayName
    ? `${displayName} <${user.email}>`
    : user.email;

  const providedReason = cleanText(reason || "");
  const escalationReason = providedReason
    ? truncate(providedReason, MAX_REASON)
    : documents.length > 0
      ? "La información recuperada no permitió confirmar una solución definitiva; se requiere revisión de un especialista."
      : "No se encontró evidencia suficiente en la base de conocimiento para resolver el problema.";

  return {
    summary: truncate(firstUserText, MAX_SUMMARY),
    description: truncate(excerpt || firstUserText, MAX_DESCRIPTION),
    category: categorizeSupportIssue(allText),
    priority: prioritizeSupportIssue(allText),
    reported_by: reportedBy,
    troubleshooting_steps: troubleshootingSteps,
    escalation_reason: escalationReason,
  };
}
