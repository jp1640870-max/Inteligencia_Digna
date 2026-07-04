//Este archivo es un componente de React, un bloque de código con resaltado de sintaxis 
// y funcionalidad de copia al portapapeles.

"use client";

import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

const CodeBlock = ({ inline, className, children }: any) => {
  const match = /language-(\w+)/.exec(className || "");
  const code = String(children).trim();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (inline) {
    return (
      <code className="bg-[#1e293b] px-1.5 py-0.5 rounded text-green-300">
        {code}
      </code>
    );
  }

  return (
    <div className="relative mt-4 rounded-xl overflow-hidden border border-[#1f2632]">
      <div className="flex justify-between items-center px-3 py-1 bg-[#0d1117]">
        <span className="text-xs text-gray-400">
          {match?.[1] || "code"}
        </span>
        <button
          onClick={copy}
          className={`text-xs px-2 py-1 rounded transition ${
            copied ? "bg-green-500" : "bg-[#1f2937] hover:bg-[#374151]"
          }`}
        >
          {copied ? "Copiado ✅" : "Copiar"}
        </button>
      </div>
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={match?.[1] || "javascript"}
        PreTag="div"
        customStyle={{ margin: 0, padding: "16px", background: "#0d1117" }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};

export default CodeBlock;
