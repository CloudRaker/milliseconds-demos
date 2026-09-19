// The fake local index: what the macOS original read from disk, Chrome history and `shortcuts
// list`, frozen as fixtures. Files and history rows keep the ages from the original's
// TESTING.md, expressed in minutes before page load so the recency phrases stay honest.

export type Kind =
  | "open_app"
  | "open_file"
  | "open_url"
  | "web_search"
  | "calculate"
  | "system_toggle"
  | "run_shortcut"
  | "group";

export interface Candidate {
  id: string;
  title: string;
  subtitle: string;
  kind: Kind;
  keywords: string[];
  /** Minutes since the file was modified or the page visited; undefined for timeless items. */
  ageMinutes?: number;
  /** open_url rows. */
  url?: string;
  /** calculate rows. */
  result?: string;
  /** group rows. */
  members?: Candidate[];
}

export const KIND_LABEL: Record<Kind, string> = {
  open_app: "App",
  open_file: "File",
  open_url: "Link",
  web_search: "Web",
  calculate: "Calc",
  system_toggle: "System",
  run_shortcut: "Shortcut",
  group: "Set",
};

const plural = (n: number, unit: string) => (n === 1 ? `1 ${unit}` : `${n} ${unit}s`);

/** LocalIndex.recency(): the model reads recency far better as words than as timestamps. */
export function recency(ageMinutes: number, verb = "modified"): string {
  const days = ageMinutes / 1440;
  if (ageMinutes < 2) return `${verb} just now`;
  if (ageMinutes < 60) return `${verb} ${Math.floor(ageMinutes)} min ago`;
  if (days < 1) return `${verb} ${Math.floor(ageMinutes / 60)} h ago`;
  if (days < 2) return `${verb} yesterday`;
  if (days < 30) return `${verb} ${plural(Math.floor(days), "day")} ago`;
  if (days < 365) return `${verb} ${plural(Math.floor(days / 30), "month")} ago`;
  return `${verb} over a year ago`;
}

/** LocalIndex.fileTypeWords(). */
function fileTypeWords(ext: string): string[] {
  switch (ext) {
    case "pdf":
      return ["document", "paper"];
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "heic":
    case "webp":
      return ["image", "picture", "photo", "screenshot"];
    case "mov":
    case "mp4":
    case "m4v":
      return ["video", "movie", "recording"];
    case "zip":
    case "dmg":
    case "pkg":
    case "tar":
    case "gz":
      return ["archive", "installer"];
    case "md":
    case "txt":
    case "rtf":
      return ["text", "notes"];
    case "csv":
    case "xlsx":
    case "numbers":
      return ["spreadsheet", "data"];
    case "swift":
    case "ts":
    case "js":
    case "py":
      return ["code", "source"];
    default:
      return [];
  }
}

const APPS = [
  "Safari", "Slack", "Mail", "Calendar", "Notes", "Reminders", "Messages", "Photos", "Music",
  "Maps", "Finder", "Preview", "Terminal", "Xcode", "Visual Studio Code", "Figma", "Linear",
  "Notion", "Spotify", "Zoom", "Docker Desktop", "Postgres", "Dashboard", "Discord", "Obsidian",
  "1Password", "System Settings", "Activity Monitor", "Disk Utility", "Screenshot",
];

/** Candidate.swift SystemToggle: the nine toggles, verbatim. */
const TOGGLES: Array<[string, string, string, string[]]> = [
  ["toggleDarkMode", "Toggle Dark Mode", "Switch appearance between light and dark", ["dark", "light", "theme", "appearance", "night", "mode"]],
  ["wifiOn", "Turn Wi-Fi On", "Enable the Wi-Fi radio", ["wifi", "wi-fi", "wireless", "network", "on", "enable", "connect"]],
  ["wifiOff", "Turn Wi-Fi Off", "Disable the Wi-Fi radio", ["wifi", "wi-fi", "wireless", "network", "off", "disable", "airplane"]],
  ["doNotDisturb", "Do Not Disturb", "Open Focus settings to silence notifications", ["dnd", "focus", "quiet", "silence", "notifications", "mute"]],
  ["sleep", "Sleep", "Put the Mac to sleep now", ["sleep", "nap", "rest", "suspend", "standby"]],
  ["lockScreen", "Lock Screen", "Lock the screen immediately", ["lock", "afk", "away", "secure", "screen"]],
  ["emptyTrash", "Empty Trash", "Permanently delete everything in the Trash", ["trash", "bin", "delete", "clean", "purge"]],
  ["showHiddenFiles", "Show Hidden Files", "Reveal dotfiles and hidden items in Finder", ["hidden", "dotfiles", "invisible", "reveal", "finder"]],
  ["hideHiddenFiles", "Hide Hidden Files", "Hide dotfiles and hidden items in Finder", ["hidden", "dotfiles", "invisible", "conceal", "finder"]],
];

/** TESTING.md fixtures: five files of different ages plus the two from the set queries. */
const FILES: Array<[string, string, number]> = [
  ["Q3-Roadmap-Review.pdf", "~/Downloads", 6],
  ["Design-Review-Notes.pdf", "~/Downloads", 21],
  ["Hiring-Plan-Q4.pdf", "~/Downloads", 34],
  ["invoice-2026-08.pdf", "~/Downloads", 49 * 1440],
  ["Lease-Agreement.pdf", "~/Desktop", 80 * 1440],
  ["xcode-installer.dmg", "~/Downloads", 9 * 1440],
  ["screenshot-2026-09-17.png", "~/Downloads", 2 * 1440],
];

/** TESTING.md fixtures: the nine seeded Chrome history rows, with hours since the visit. */
const HISTORY: Array<[string, string, number]> = [
  ["https://cognition.ai/blog/devin-ambassador-program", "Introducing the Devin Ambassador Program", 2],
  ["https://docs.devin.ai/ambassadors/getting-started", "Devin Ambassadors: Getting Started", 5],
  ["https://community.devin.ai/t/ambassador-kickoff-call", "Ambassador kickoff call notes - Devin Community", 20],
  ["https://cognition.ai/blog/devin-ambassador-program?ref=tw", "Introducing the Devin Ambassador Program", 70],
  ["https://www.youtube.com/watch?v=lofi", "lofi hip hop radio - beats to relax/study to", 1],
  ["https://milliseconds.ai/", "milliseconds.ai", 3],
  ["https://news.ycombinator.com/", "Hacker News", 4],
  ["https://docs.milliseconds.ai/concepts/decisions", "Decisions - milliseconds.ai Docs", 6],
  ["https://en.wikipedia.org/wiki/Transformer_(deep_learning)", "Transformer (deep learning) - Wikipedia", 30],
];

const SHORTCUTS = ["Start Focus Session", "Resize Screenshots", "Daily Standup Note"];

function hostOf(url: string): string {
  const host = new URL(url).hostname;
  return host.startsWith("www.") ? host.slice(4) : host;
}

function hostWords(host: string): string[] {
  const parts = host.split(".");
  if (parts.length < 2) return parts;
  return [...parts.slice(0, -1), parts.slice(-2).join(".")];
}

/** The whole fake machine, built once. Deterministic: ages are fixed offsets, not clock reads. */
export const INDEX: Candidate[] = [
  ...APPS.map((title) => ({
    id: `app:${title}`,
    title,
    subtitle: "Application",
    kind: "open_app" as const,
    keywords: ["app", "application"],
  })),
  ...FILES.map(([name, folder, ageMinutes]) => {
    const ext = name.split(".").pop()!.toLowerCase();
    const keywords = [folder.slice(2).toLowerCase(), "file", ext, ...fileTypeWords(ext)];
    if (folder === "~/Downloads") keywords.push("downloaded", "download");
    if (ageMinutes < 1440) keywords.push("recent", "latest", "new", "today");
    return {
      id: `file:${folder}/${name}`,
      title: name,
      subtitle: `${ext.toUpperCase()} in ${folder} · ${recency(ageMinutes)}`,
      kind: "open_file" as const,
      keywords,
      ageMinutes,
    };
  }),
  ...TOGGLES.map(([id, title, subtitle, keywords]) => ({
    id: `toggle:${id}`,
    title,
    subtitle,
    kind: "system_toggle" as const,
    keywords,
  })),
  ...SHORTCUTS.map((title) => ({
    id: `shortcut:${title}`,
    title,
    subtitle: "Shortcut",
    kind: "run_shortcut" as const,
    keywords: ["shortcut", "automation"],
  })),
  ...HISTORY.map(([url, title, hours]) => {
    const host = hostOf(url);
    const ageMinutes = hours * 60;
    const keywords = [
      "link", "links", "page", "site", "website", "url", "tab", "tabs", "visited", "history",
      "browser", "chrome", "web",
      ...hostWords(host),
      ...new URL(url).pathname.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length >= 3),
    ];
    if (ageMinutes < 1440) keywords.push("recent", "latest", "today");
    return {
      id: `url:${url}`,
      title,
      subtitle: `${host} · ${recency(ageMinutes, "visited")}`,
      kind: "open_url" as const,
      keywords,
      ageMinutes,
      url,
    };
  }),
];

/** The chips in the original's empty state. */
export const EXAMPLES = [
  "dark",
  "wifi off",
  "15% of 240",
  "the pdf I just downloaded",
  "open devin ambassador links I visited in the past 24 hours",
  "the files I downloaded in the last hour",
];
