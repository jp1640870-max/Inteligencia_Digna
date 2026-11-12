"use client";

import { ExternalLink, Globe2 } from "lucide-react";
import type { SearchResult } from "@/types";

type Props = {
  sources: SearchResult[];
  idPrefix: string;
};

const FAVICON_COLORS = ["#0ea5e9", "#f97316", "#8b5cf6", "#22c55e", "#ec4899"];

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || url;
  }
}

const MessageSources = ({ sources, idPrefix }: Props) => {
  return (
    <section className="chat-sources" aria-label="Fuentes consultadas">
      <div className="chat-sources-head">
        <Globe2 size={15} aria-hidden="true" />
        <span>Fuentes</span>
        <span className="chat-sources-count">· {sources.length}</span>
      </div>
      <div className="chat-source-grid">
        {sources.map((source, index) => (
          <a
            key={`${source.url}-${index}`}
            id={`${idPrefix}-source-${index + 1}`}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="chat-source-card"
            aria-label={`Fuente ${index + 1}: ${source.title}`}
          >
            <span
              className="chat-source-favicon"
              style={{ backgroundColor: FAVICON_COLORS[index % FAVICON_COLORS.length] }}
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <span className="chat-source-main">
              <span className="chat-source-title">{source.title}</span>
              <span className="chat-source-domain">{getDomain(source.url)}</span>
              {source.snippet && (
                <span className="chat-source-snippet">{source.snippet}</span>
              )}
            </span>
            <ExternalLink
              size={13}
              className="chat-source-external"
              aria-hidden="true"
            />
          </a>
        ))}
      </div>
    </section>
  );
};

export default MessageSources;
