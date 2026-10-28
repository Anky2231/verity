import { BookOpenCheck, Layers, MessageSquareText, ShieldCheck, SpellCheck, TrendingUp } from "lucide-react";
import type { TunnelItem } from "../components/ui/perspective-tunnel-hero";

// What the landing hero's corridor shows: the things Verity checks. The first three are real VisualGuard output
// (scripts/make_landing_art.py); the rest are icon panels.
export const LANDING_ITEMS: TunnelItem[] = [
  { id: "visual-colour", title: "VisualGuard", caption: "A logo in the wrong colours, boxed and cited.", src: "/landing/visual-colour.jpg" },
  { id: "guidelines", title: "Guidelines", caption: "Upload a PDF or DOCX. Rules, terms and claims are extracted for you to approve.", icon: BookOpenCheck, tone: "indigo" },
  { id: "tone", title: "ToneGuard", caption: "Voice and tone against the brand's own rules.", icon: MessageSquareText, tone: "violet" },
  { id: "visual-proportions", title: "VisualGuard", caption: "A stretched logo is caught and named.", src: "/landing/visual-proportions.jpg" },
  { id: "term", title: "TermGuard", caption: "Banned and approved wording, with the spelling variants.", icon: SpellCheck, tone: "emerald" },
  { id: "claim", title: "ClaimGuard", caption: "Claims checked against the approved register, with source and page.", icon: ShieldCheck, tone: "amber" },
  { id: "visual-palette", title: "VisualGuard", caption: "Colours that are not in the brand palette.", src: "/landing/visual-palette.jpg" },
  { id: "brands", title: "Many brands", caption: "One person, several brands. Wording from another brand is flagged.", icon: Layers, tone: "sky" },
  { id: "drift", title: "Brand drift", caption: "Which teams are slowly moving off-brand, before it piles up.", icon: TrendingUp, tone: "rose" },
];
