"use client";

import type { ReactNode } from "react";

import {
  ChatIcon,
  ChevronLeftIcon,
  ExternalIcon,
  ForumIcon,
  HelpIcon,
  LogoMark,
  PhrasePumpIcon,
  PlayIcon,
  SavedListIcon,
  SettingsIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";

export type NavId =
  | "media"
  | "chatbot"
  | "phrasepump"
  | "saved"
  | "help"
  | "settings"
  | "forum";

interface NavItem {
  id: NavId;
  label: string;
  icon: ReactNode;
  badge?: string;
  soon?: boolean;
  external?: boolean;
}

const NAV: NavItem[] = [
  { id: "media", label: "Nội dung", icon: <PlayIcon />, soon: true },
  {
    id: "chatbot",
    label: "Chatbot",
    icon: <ChatIcon />,
    badge: "NEW!",
    soon: true,
  },
  {
    id: "phrasepump",
    label: "PhrasePump",
    icon: <PhrasePumpIcon />,
    soon: true,
  },
  { id: "saved", label: "Đã lưu", icon: <SavedListIcon /> },
  { id: "help", label: "Giúp đỡ", icon: <HelpIcon />, soon: true },
  { id: "settings", label: "Cài đặt", icon: <SettingsIcon /> },
];

interface SideNavProps {
  collapsed: boolean;
  onToggle: () => void;
  activeId: NavId;
  onNavigate: (id: NavId) => void;
}

export function SideNav({
  collapsed,
  onToggle,
  activeId,
  onNavigate,
}: SideNavProps) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-white/8 bg-[var(--sidebar)] transition-[width] duration-200",
        collapsed ? "w-[64px]" : "w-[240px]",
      )}
    >
      <div className="flex h-14 items-center gap-2 px-3">
        <LogoMark />
        {!collapsed && (
          <span className="font-[family-name:var(--font-brand)] text-[15px] font-normal tracking-wide text-white">
            Language Caption
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="ml-auto rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
          aria-label={collapsed ? "Mở sidebar" : "Thu sidebar"}
        >
          <ChevronLeftIcon
            className={cn("transition-transform", collapsed && "rotate-180")}
          />
        </button>
      </div>

      <div className="mx-2 mb-2 rounded-md border border-white/10 bg-white/5 px-2 py-1.5">
        <div className="flex items-center gap-2 text-[13px] text-white/85">
          <span className="flex size-5 items-center justify-center rounded bg-[#37ae92] text-[11px] font-bold text-white">
            日
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 truncate">日本語</span>
              <span className="text-white/35">▾</span>
            </>
          )}
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2">
        {NAV.map((item) => {
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              disabled={item.soon}
              title={item.soon ? "Sắp có" : item.label}
              onClick={() => {
                if (!item.soon) onNavigate(item.id);
              }}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-left text-[14px] transition-colors",
                active
                  ? "bg-[color-mix(in_srgb,#9c40bf_28%,transparent)] text-white shadow-[inset_3px_0_0_#9c40bf]"
                  : "text-white/75 hover:bg-white/6 hover:text-white",
                item.soon && "cursor-not-allowed opacity-55",
              )}
            >
              <span className="shrink-0 text-white/80">{item.icon}</span>
              {!collapsed && (
                <>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge && (
                    <span className="rounded bg-[#9c40bf] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {item.badge}
                    </span>
                  )}
                  {item.soon && !item.badge && (
                    <span className="text-[10px] text-white/40">sắp có</span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/8 px-2 py-2">
        <a
          href="https://forum.languagelearningwithnetflix.com/"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-md px-2.5 py-2 text-[14px] text-white/70 hover:bg-white/6 hover:text-white"
        >
          <ForumIcon />
          {!collapsed && (
            <>
              <span className="flex-1">Diễn đàn</span>
              <ExternalIcon className="opacity-50" />
            </>
          )}
        </a>
        <div
          className="flex items-center gap-3 rounded-md px-2.5 py-2 text-[14px] text-white/40"
          title="Không dùng đăng nhập LR — dữ liệu local / extension"
        >
          <span className="inline-flex size-5 items-center justify-center rounded border border-white/20 text-[10px]">
            ·
          </span>
          {!collapsed && <span>Local demo · không đăng nhập</span>}
        </div>
      </div>
    </aside>
  );
}
