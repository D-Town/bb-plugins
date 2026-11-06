import type { FilePreviewOutput, TreeEntry } from "./contracts";

export type Locale = "en" | "de";
export type LocalePreference = Locale | "auto";
type GitState = NonNullable<TreeEntry["gitState"]>;
type PreviewErrorReason = Extract<FilePreviewOutput, { outcome: "unavailable" }>["reason"];

export type Translator = {
  locale: Locale;
  tree: string;
  items: (count: number) => string;
  projectFiles: string;
  refresh: string;
  settings: string;
  diff: string;
  size: string;
  lastModified: string;
  fullPath: string;
  nerdFontIcons: string;
  autoCollapse: string;
  colors: string;
  read: string;
  write: string;
  added: string;
  deleted: string;
  modified: string;
  diffAdd: string;
  diffDelete: string;
  colorFor: (label: string) => string;
  language: string;
  languageAuto: string;
  languageEnglish: string;
  languageGerman: string;
  justNow: string;
  loadingFiles: string;
  loading: string;
  loadingPath: (path: string) => string;
  noActiveWorkspace: string;
  noWorkspace: string;
  workspaceUnavailable: string;
  couldNotLoad: (path: string) => string;
  directoryUnavailable: string;
  retry: (path: string) => string;
  refreshing: (path: string) => string;
  couldNotRefresh: (path: string) => string;
  retryRefresh: string;
  noFiles: string;
  truncated: string;
  gitStateLabels: Record<GitState, string>;
  gitDescription: (state: string) => string;
  diffDescription: (additions: number, deletions: number) => string;
  childrenLoadFailure: string;
  filePreview: string;
  loadingPreview: string;
  previewOf: (path: string) => string;
  previewErrors: Record<PreviewErrorReason, string>;
};

const english: Omit<Translator, "locale"> = {
  tree: "File tree",
  items: (count) => `${count} items`,
  projectFiles: "Project files",
  refresh: "Refresh file tree",
  settings: "File tree settings",
  diff: "Diff +/−",
  size: "Size",
  lastModified: "Last modified",
  fullPath: "Full path",
  nerdFontIcons: "Nerd Font icons",
  autoCollapse: "Auto-collapse",
  colors: "Colors",
  read: "Read",
  write: "Write",
  added: "Added",
  deleted: "Deleted",
  modified: "Modified",
  diffAdd: "Diff additions",
  diffDelete: "Diff deletions",
  colorFor: (label) => `${label} color`,
  language: "Language",
  languageAuto: "Auto (host)",
  languageEnglish: "English",
  languageGerman: "German",
  justNow: "just now",
  loadingFiles: "Loading files…",
  loading: "Loading…",
  loadingPath: (path) => `Loading ${path}`,
  noActiveWorkspace: "No active workspace.",
  noWorkspace: "This thread has no workspace.",
  workspaceUnavailable: "The workspace is currently unavailable.",
  couldNotLoad: (path) => `Could not load ${path || "files"}:`,
  directoryUnavailable: "Directory unavailable.",
  retry: (path) => `Retry ${path || "files"}`,
  refreshing: (path) => `Refreshing ${path || "files"}`,
  couldNotRefresh: (path) => `Could not refresh ${path || "files"}.`,
  retryRefresh: "Retry refresh",
  noFiles: "No files found.",
  truncated: "Showing the first 10,000 paths.",
  gitStateLabels: {
    clean: "clean",
    modified: "modified",
    added: "added",
    deleted: "deleted",
    renamed: "renamed",
    untracked: "untracked",
  },
  gitDescription: (state) => `Git: ${state}.`,
  diffDescription: (additions, deletions) => `Diff: +${additions}, -${deletions}.`,
  childrenLoadFailure: "Could not load children. Press ArrowRight to retry.",
  filePreview: "File preview",
  loadingPreview: "Loading preview…",
  previewOf: (path) => `Preview of ${path}`,
  previewErrors: {
    unsupported: "Unsupported file type for inline preview. Open this file in BB's preview-capable surface.",
    too_large: "This file is too large for inline preview (64 KiB limit).",
    invalid_path: "This file path is unavailable.",
    no_workspace: "No workspace is available for preview.",
    environment_unavailable: "The workspace is currently unavailable.",
    file_unavailable: "This file could not be previewed.",
  },
};

const german: Partial<Omit<Translator, "locale">> = {
  tree: "Dateibaum",
  items: (count) => `${count} Elemente`,
  projectFiles: "Projektdateien",
  refresh: "Dateibaum aktualisieren",
  settings: "Dateibaum-Einstellungen",
  diff: "Diff +/−",
  size: "Größe",
  lastModified: "Zuletzt geändert",
  fullPath: "Voller Pfad",
  nerdFontIcons: "Nerd-Font-Icons",
  autoCollapse: "Auto-Zuklappen",
  colors: "Farben",
  read: "Lesen",
  write: "Schreiben",
  added: "Hinzugefügt",
  deleted: "Gelöscht",
  modified: "Geändert",
  diffAdd: "Diff-Zunahmen",
  diffDelete: "Diff-Abnahmen",
  colorFor: (label) => `Farbe für ${label}`,
  language: "Sprache",
  languageAuto: "Automatisch (Host)",
  languageEnglish: "Englisch",
  languageGerman: "Deutsch",
  justNow: "gerade eben",
  loadingFiles: "Dateien werden geladen…",
  loading: "Wird geladen…",
  loadingPath: (path) => `${path} wird geladen`,
  noActiveWorkspace: "Kein aktiver Arbeitsbereich.",
  noWorkspace: "Dieser Thread hat keinen Arbeitsbereich.",
  workspaceUnavailable: "Der Arbeitsbereich ist derzeit nicht verfügbar.",
  couldNotLoad: (path) => `${path || "Dateien"} konnten nicht geladen werden:`,
  directoryUnavailable: "Verzeichnis nicht verfügbar.",
  retry: (path) => `${path || "Dateien"} erneut laden`,
  refreshing: (path) => `${path || "Dateien"} werden aktualisiert`,
  couldNotRefresh: (path) => `${path || "Dateien"} konnten nicht aktualisiert werden.`,
  retryRefresh: "Aktualisierung wiederholen",
  noFiles: "Keine Dateien gefunden.",
  truncated: "Die ersten 10.000 Pfade werden angezeigt.",
  gitStateLabels: {
    clean: "sauber",
    modified: "geändert",
    added: "hinzugefügt",
    deleted: "gelöscht",
    renamed: "umbenannt",
    untracked: "nicht verfolgt",
  },
  gitDescription: (state) => `Git: ${state}.`,
  diffDescription: (additions, deletions) => `Diff: +${additions}, -${deletions}.`,
  childrenLoadFailure: "Unterelemente konnten nicht geladen werden. Mit Pfeil rechts erneut versuchen.",
  filePreview: "Dateivorschau",
  loadingPreview: "Vorschau wird geladen…",
  previewOf: (path) => `Vorschau von ${path}`,
  previewErrors: {
    unsupported: "Dieser Dateityp kann nicht inline angezeigt werden. Öffne die Datei in einer BB-Vorschau.",
    too_large: "Diese Datei ist für die Inline-Vorschau zu groß (Limit: 64 KiB).",
    invalid_path: "Dieser Dateipfad ist nicht verfügbar.",
    no_workspace: "Für die Vorschau ist kein Arbeitsbereich verfügbar.",
    environment_unavailable: "Der Arbeitsbereich ist derzeit nicht verfügbar.",
    file_unavailable: "Diese Datei konnte nicht in der Vorschau angezeigt werden.",
  },
};

export function resolveLocale(language: string | null | undefined): Locale {
  return language?.trim().toLowerCase().startsWith("de") ? "de" : "en";
}

export function detectLocale(): Locale {
  const documentLanguage = typeof document !== "undefined" ? document.documentElement.lang : "";
  if (documentLanguage) return resolveLocale(documentLanguage);
  const navigatorLanguage = typeof navigator !== "undefined" ? navigator.language : "";
  return resolveLocale(navigatorLanguage);
}

export function resolveLocalePreference(preference: LocalePreference, detected: Locale): Locale {
  return preference === "auto" ? detected : preference;
}

export function createTranslator(locale: Locale = detectLocale()): Translator {
  return { locale, ...english, ...(locale === "de" ? german : {}) } as Translator;
}

export function formatMtime(mtimeMs: number, locale: Locale, nowMs = Date.now()): string {
  const translator = createTranslator(locale);
  const minutes = Math.max(0, Math.floor((nowMs - mtimeMs) / 60_000));
  if (minutes < 1) return translator.justNow;
  const intlLocale = locale === "de" ? "de-DE" : "en-US";
  const relative = new Intl.RelativeTimeFormat(intlLocale, { numeric: "always", style: "short" });
  if (minutes < 60) return relative.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  return new Intl.DateTimeFormat(intlLocale).format(new Date(mtimeMs));
}
