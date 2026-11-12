"use client";

import {
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { ExternalLink, X, ZoomIn } from "lucide-react";
import CodeBlock from "./CodeBlock";
import type { SearchResult } from "@/types";

type Props = {
  text: string;
  sources?: SearchResult[];
  sourceIdPrefix: string;
  darkMode: boolean;
  compact?: boolean;
  showCursor?: boolean;
};

type LightboxImage = {
  src: string;
  alt: string;
};

const SOURCES_HEADING =
  /^(?:#{1,4}\s*)?(?:\*\*)?(fuentes consultadas|fuentes|referencias|references)(?:\*\*)?\s*:?$/i;

function stripSourcesSection(text: string): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (SOURCES_HEADING.test(lines[i].trim())) {
      return lines.slice(0, i).join("\n").trim();
    }
  }
  return text;
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return value.replace(/\/$/, "").toLowerCase();
  }
}

function childrenToText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(childrenToText).join("");
  }
  if (isValidElement(children)) {
    return childrenToText((children.props as { children?: ReactNode }).children);
  }
  return "";
}

const MarkdownMessage = ({
  text,
  sources,
  sourceIdPrefix,
  darkMode,
  compact = false,
  showCursor = false,
}: Props) => {
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);

  const content = useMemo(
    () => (sources && sources.length > 0 ? stripSourcesSection(text) : text),
    [text, sources],
  );

  useEffect(() => {
    if (!lightbox) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightbox]);

  const handleCitationClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    sourceIndex: number,
  ) => {
    event.preventDefault();
    const targetId = `${sourceIdPrefix}-source-${sourceIndex + 1}`;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("chat-source-flash");
    target.focus({ preventScroll: true });
    window.setTimeout(() => target.classList.remove("chat-source-flash"), 1400);
  };

  const components: Components = {
    pre: ({ children }) => {
      const child = Array.isArray(children) ? children[0] : children;
      if (isValidElement(child)) {
        const props = child.props as {
          className?: string;
          children?: ReactNode;
        };
        const value = String(props.children ?? "").replace(/\n$/, "");
        if (value) {
          const language = /language-([\w-]+)/.exec(props.className || "")?.[1];
          return <CodeBlock code={value} language={language} />;
        }
      }
      return <pre className="chat-code-fallback">{children}</pre>;
    },
    code: ({ className, children }) => {
      const language = /language-([\w-]+)/.exec(className || "")?.[1];
      const value = String(children).replace(/\n$/, "");
      if (language) return <CodeBlock code={value} language={language} />;
      return <code className="chat-inline-code">{children}</code>;
    },
    a: ({ href, children, title }) => {
      if (!href) return <span>{children}</span>;

      const sourceIndex = sources
        ? sources.findIndex((source) => normalizeUrl(source.url) === normalizeUrl(href))
        : -1;
      const isCitation = /^\[?\s*\d+\s*\]?$/.test(childrenToText(children).trim());

      if (sourceIndex >= 0 && isCitation) {
        const source = sources?.[sourceIndex];
        return (
          <a
            href={`#${sourceIdPrefix}-source-${sourceIndex + 1}`}
            className="chat-citation"
            title={source ? `Fuente ${sourceIndex + 1}: ${source.title}` : title}
            aria-label={source ? `Ir a la fuente ${sourceIndex + 1}` : `Ir a la fuente`}
            onClick={(event) => handleCitationClick(event, sourceIndex)}
          >
            {sourceIndex + 1}
          </a>
        );
      }

      return (
        <a
          href={href}
          className="chat-link"
          title={title}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
          <ExternalLink size={11} className="chat-link-icon" aria-hidden="true" />
        </a>
      );
    },
    table: ({ children }) => (
      <div className="chat-table-wrap">
        <table>{children}</table>
      </div>
    ),
    blockquote: ({ children }) => (
      <blockquote className="chat-md-quote">{children}</blockquote>
    ),
    img: ({ src, alt, title }) => {
      const imageSrc = typeof src === "string" ? src : null;
      if (!imageSrc) return null;
      const description = alt || title || "Imagen";
      return (
        <span className="chat-md-figure">
          <button
            type="button"
            className="chat-md-image-button"
            onClick={() => setLightbox({ src: imageSrc, alt: description })}
            aria-label={`Ampliar imagen: ${description}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageSrc} alt={description} loading="lazy" decoding="async" />
            <span className="chat-md-zoom-hint">
              <ZoomIn size={13} aria-hidden="true" />
              Ampliar
            </span>
          </button>
          {description && <span className="chat-md-caption">{description}</span>}
        </span>
      );
    },
  };

  return (
    <div
      className={`chat-markdown ${compact ? "chat-markdown-compact" : ""} ${
        darkMode ? "chat-theme-dark" : "chat-theme-light"
      }`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {content || ""}
      </ReactMarkdown>
      {showCursor && <span className="chat-stream-cursor" aria-hidden="true" />}

      {lightbox && (
        <div
          className="chat-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Imagen ampliada"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLightbox(null);
          }}
        >
          <button
            type="button"
            className="chat-lightbox-close"
            onClick={() => setLightbox(null)}
            aria-label="Cerrar imagen"
            title="Cerrar imagen"
          >
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.src} alt={lightbox.alt} />
        </div>
      )}
    </div>
  );
};

export default MarkdownMessage;
