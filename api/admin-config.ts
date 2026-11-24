/**
 * Admin system config — phase + window management + auto-create sections.
 * Rate limited + error sanitized.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminSupabase } from "./_supabase-admin";
import { handleCors, getIp, checkRateLimit, verifyAdmin, safeError } from "./_utils";

const VALID_PHASES = [
  "SPEC_WINDOW_OPEN", "SPEC_WINDOW_CLOSED",
  "SECTIONS_FINALIZED", "SECTION_WINDOW_OPEN", "SECTION_WINDOW_CLOSED",
] as const;

const SECTION_NAMES = ["A","B","C","D","E","F","G","H","I","J"];
const TARGET_CAP = 50;

/** Abbreviate a specialization name → e.g. "AIML", "DS", "FS", "CS", "CC" */
function specAbbrev(name: string): string {
  const map: Record<string, string> = {
    "artificial intelligence and machine learning": "AIML",
    "ai/ml": "AIML",
    "aiml": "AIML",
    "data science": "DS",
    "cyber security": "CS",
    "cybersecurity": "CS",
    "full stack": "FS",
    "cloud computing": "CC",
  };
  const lower = name.toLowerCase().trim();
  for (const [key, abbr] of Object.entries(map)) {
    if (lower.includes(key)) return abbr;
  }
  // Fallback: first letters of each word, max 4 chars
  return name.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 4);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  const admin = await verifyAdmin(req);
  if ("error" in admin) return res.status(403).json(admin);

  const rl = await checkRateLimit({
    action: "admin_config", email: admin.email, ip: getIp(req),
    perEmailLimit: 20, perIpLimit: 40, windowMinutes: 1,
  });
  if (rl.limited) return res.status(429).json({ error: rl.message });

  // ── GET ──────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { data, error } = await adminSupabase
      .from("system_config").select("*").eq("id", 1).single();
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ data });
  }

  // ── PUT — update phase/window ─────────────────────────────────
  if (req.method === "PUT") {
    const { phase, spec_window_open, section_window_open, section_window_deadline } = req.body ?? {};
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (phase !== undefined) {
      if (!(VALID_PHASES as readonly string[]).includes(phase)) {
        return res.status(400).json({ error: "Invalid phase value." });
      }
      updates.phase = phase;
      const windowMap: Record<string, { spec_window_open: boolean; section_window_open: boolean }> = {
        SPEC_WINDOW_OPEN:     { spec_window_open: true,  section_window_open: false },
        SPEC_WINDOW_CLOSED:   { spec_window_open: false, section_window_open: false },
        SECTIONS_FINALIZED:   { spec_window_open: false, section_window_open: false },
        SECTION_WINDOW_OPEN:  { spec_window_open: false, section_window_open: true  },
        SECTION_WINDOW_CLOSED:{ spec_window_open: false, section_window_open: false },
      };
      Object.assign(updates, windowMap[phase]);
    }
    if (typeof spec_window_open    === "boolean") updates.spec_window_open    = spec_window_open;
    if (typeof section_window_open === "boolean") updates.section_window_open = section_window_open;
    if (typeof req.body?.spec_window_new_only    === "boolean") updates.spec_window_new_only    = req.body.spec_window_new_only;
    if (typeof req.body?.section_window_new_only === "boolean") updates.section_window_new_only = req.body.section_window_new_only;
    if (section_window_deadline !== undefined)    updates.section_window_deadline = section_window_deadline;

    const { error } = await adminSupabase.from("system_config").update(updates).eq("id", 1);
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ ok: true });
  }

  // ── POST — top-up section creation (safe, never deletes existing seats) ──
  if (req.method === "POST") {
    const { data: specs } = await adminSupabase
      .from("specializations").select("id, name").eq("active", true);
    if (!specs?.length) return res.status(400).json({ error: "No active specializations found." });

    // Count students per specialization (all who have chosen one)
    const { data: students } = await adminSupabase
      .from("students").select("chosen_specialization_id")
      .not("chosen_specialization_id", "is", null);

    const totalBySpec: Record<string, number> = {};
    for (const s of students ?? []) {
      if (s.chosen_specialization_id)
        totalBySpec[s.chosen_specialization_id] = (totalBySpec[s.chosen_specialization_id] ?? 0) + 1;
    }

    // Load existing sections with their current seat occupancy
    const { data: existingSections } = await adminSupabase
      .from("sections")
      .select("id, name, capacity, specialization_id");

    const sectionsBySpec: Record<string, { id: string; name: string; capacity: number }[]> = {};
    for (const sec of existingSections ?? []) {
      if (!sectionsBySpec[sec.specialization_id]) sectionsBySpec[sec.specialization_id] = [];
      sectionsBySpec[sec.specialization_id].push(sec);
    }

    const toInsert: { specialization_id: string; name: string; capacity: number }[] = [];

    for (const spec of specs) {
      const total = totalBySpec[spec.id] ?? 0;
      if (!total) continue;

      const existing = sectionsBySpec[spec.id] ?? [];
      const existingCap = existing.reduce((sum, s) => sum + s.capacity, 0);

      if (existingCap >= total) continue; // existing sections have enough room — no new sections needed

      // Need to create sections to cover the overflow
      const overflow = total - existingCap;
      const newSectionCount = Math.ceil(overflow / TARGET_CAP);
      const usedNames = new Set(existing.map((s) => s.name.split("-").pop() ?? ""));
      let nameIdx = 0;
      for (let i = 0; i < newSectionCount; i++) {
        // Find next unused letter
        while (nameIdx < SECTION_NAMES.length && usedNames.has(SECTION_NAMES[nameIdx])) nameIdx++;
        const letter = SECTION_NAMES[nameIdx] ?? String(existing.length + i + 1);
        const base = Math.floor(overflow / newSectionCount);
        const rem  = overflow % newSectionCount;
        const cap  = i < rem ? base + 1 : base;
        toInsert.push({ specialization_id: spec.id, name: `${specAbbrev(spec.name)}-${letter}`, capacity: cap });
        nameIdx++;
      }
    }

    // If no existing sections at all and nothing to insert — error
    const hasAnySections = (existingSections ?? []).length > 0 || toInsert.length > 0;
    if (!hasAnySections) return res.status(400).json({ error: "No student specialization selections found." });

    if (toInsert.length > 0) {
      const { error } = await adminSupabase.from("sections").insert(toInsert);
      if (error) return res.status(500).json({ error: safeError(error) });
    }

    await adminSupabase.from("system_config")
      .update({ phase:"SPEC_WINDOW_CLOSED", spec_window_open:false, spec_window_new_only:false, section_window_open:false, updated_at:new Date().toISOString() })
      .eq("id",1);

    return res.status(200).json({ ok: true, sectionsCreated: toInsert.length });
  }

  return res.status(405).json({ error: "Method not allowed." });
}
