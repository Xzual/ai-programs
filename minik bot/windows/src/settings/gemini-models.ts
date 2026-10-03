// Checked against Google's model/deprecation documentation on 2026-10-01.
// Catalog availability is not a promise of account access or remaining quota.
export const GEMINI_MODELS: [string, string][] = [
  ["gemini-3.8-flash", "Gemini 3.8 Flash"],
  ["gemini-3.7-flash", "Gemini 3.7 Flash"],
  ["gemini-3.6-flash", "Gemini 3.6 Flash"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash"],
  ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite · ekonomik"],
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite · ekonomik"],
  ["gemini-3.1-pro-preview", "Gemini 3.1 Pro · preview"],
  ["gemini-3-flash-preview", "Gemini 3 Flash · preview"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite · eski hesap erişimi"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash · eski hesap erişimi"],
  ["gemini-2.5-pro", "Gemini 2.5 Pro · eski hesap erişimi"],
];
export function modelLabel(id: string, fallback: string): string {
  return GEMINI_MODELS.find(([key]) => key === id)?.[1] ?? fallback;
}
