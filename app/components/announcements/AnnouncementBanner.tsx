"use client";

import { useEffect, useState } from "react";
import { X, Megaphone, AlertTriangle, Info } from "lucide-react";

type Announcement = {
  id: string;
  title: string;
  content: string;
  type: string;
};

const STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode; border: string }> = {
  info: {
    bg: "bg-blue-600/10",
    text: "text-blue-300",
    icon: <Info size={16} />,
    border: "border-blue-500/20",
  },
  warning: {
    bg: "bg-amber-600/10",
    text: "text-amber-300",
    icon: <AlertTriangle size={16} />,
    border: "border-amber-500/20",
  },
  important: {
    bg: "bg-red-600/10",
    text: "text-red-300",
    icon: <Megaphone size={16} />,
    border: "border-red-500/20",
  },
};

export default function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/announcements")
      .then((r) => r.json())
      .then((data) => setAnnouncements(data.announcements || []))
      .catch(() => {});
  }, []);

  const visible = announcements.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-1 px-4 pt-2">
      {visible.map((a) => {
        const style = STYLES[a.type] || STYLES.info;
        return (
          <div
            key={a.id}
            className={`flex items-start gap-3 px-4 py-2.5 rounded-xl border ${style.bg} ${style.border} ${style.text} text-sm`}
          >
            <span className="mt-0.5 shrink-0">{style.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-xs">{a.title}</p>
              <p className="text-xs opacity-80 mt-0.5">{a.content}</p>
            </div>
            <button
              onClick={() => setDismissed((prev) => new Set(prev).add(a.id))}
              className="shrink-0 p-0.5 rounded hover:bg-black/20 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
