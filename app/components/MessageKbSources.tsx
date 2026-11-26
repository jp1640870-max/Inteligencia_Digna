"use client";

import { FileText } from "lucide-react";
import type { KbSource } from "@/types";

type Props = {
  sources: KbSource[];
  idPrefix: string;
};

type SourceGroup = {
  key: string;
  filename: string;
  category: string | null;
  fragments: number;
  score: number;
};

function groupSources(sources: KbSource[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();

  for (const source of sources) {
    const key = source.file_id || source.filename;
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.fragments += 1;
      existing.score = Math.max(existing.score, source.score || 0);
      continue;
    }
    groups.set(key, {
      key,
      filename: source.filename || "Documento",
      category: source.category,
      fragments: 1,
      score: source.score || 0,
    });
  }

  return [...groups.values()];
}

const MessageKbSources = ({ sources, idPrefix }: Props) => {
  const groups = groupSources(sources);
  if (groups.length === 0) return null;

  return (
    <section className="chat-sources" aria-label="Documentos consultados">
      <div className="chat-sources-head">
        <FileText size={15} aria-hidden="true" />
        <span>Documentos consultados</span>
        <span className="chat-sources-count">· {groups.length}</span>
      </div>
      <div className="chat-source-grid">
        {groups.map((source, index) => (
          <div
            key={`${source.key}-${index}`}
            id={`${idPrefix}-kb-source-${index + 1}`}
            className="chat-source-card"
          >
            <div className="chat-source-main">
              <span className="chat-source-title" title={source.filename}>
                {source.filename}
              </span>
              <span className="chat-source-domain">
                {[source.category, `${source.fragments} fragmento${source.fragments === 1 ? "" : "s"}`]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="chat-source-snippet">
                Relevancia: {Math.round(source.score * 100)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default MessageKbSources;
