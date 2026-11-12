"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

type CodeBlockProps = {
  code: string;
  language?: string;
};

const CodeBlock = ({ code, language }: CodeBlockProps) => {
  const [copied, setCopied] = useState(false);
  const normalizedLanguage = language?.toLowerCase() || "text";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard no disponible */
    }
  };

  return (
    <div className="chat-code-block">
      <div className="chat-code-head">
        <span className="chat-code-lang">{normalizedLanguage}</span>
        <button
          type="button"
          onClick={copy}
          className={`chat-code-copy ${copied ? "is-copied" : ""}`}
          aria-label={copied ? "Código copiado" : "Copiar código"}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? "Copiado" : "Copiar"}</span>
        </button>
      </div>
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={normalizedLanguage}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: "14px 16px",
          background: "#0a1018",
          fontSize: "13px",
          lineHeight: 1.6,
        }}
        codeTagProps={{
          style: { fontFamily: "var(--font-geist-mono), ui-monospace, monospace" },
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};

export default CodeBlock;
