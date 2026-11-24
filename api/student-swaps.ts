/**
 * /api/student-swaps
 *
 * GET  — load all swap requests involving the calling student
 * POST — create a new swap request
 * PUT  — accept, reject, or cancel a request  { id, action: "accept"|"reject"|"cancel" }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { adminSupabase } from "./_supabase-admin";
import { handleCors, getIp, checkRateLimit, safeError } from "./_utils";

async function getStudent(userEmail: string) {
  const { data } = await adminSupabase
    .from("students")
    .select("id, assigned_section_id, chosen_specialization_id, assigned_seat, group_number")
    .eq("email", userEmail.toLowerCase())
    .maybeSingle();
  return data ?? null;
}

async function authenticate(req: VercelRequest): Promise<{ email: string } | { error: string }> {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "Authentication required." };
  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  // @ts-ignore
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user?.email) return { error: "Invalid or expired session." };
  return { email: user.email.toLowerCase() };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  const auth = await authenticate(req);
  if ("error" in auth) return res.status(401).json(auth);

  const rl = await checkRateLimit({
    action: "student_swaps", email: auth.email, ip: getIp(req),
    perEmailLimit: 30, perIpLimit: 60, windowMinutes: 1,
  });
  if (rl.limited) return res.status(429).json({ error: rl.message });

  const me = await getStudent(auth.email);
  if (!me) return res.status(403).json({ error: "Student record not found." });

  // ── GET — load requests involving this student ─────────────────
  if (req.method === "GET") {
    const { data, error } = await adminSupabase
      .from("swap_requests")
      .select("*")
      .or(`requester_id.eq.${me.id},target_id.eq.${me.id}`)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ data: data ?? [] });
  }

  // ── POST — create swap request ─────────────────────────────────
  if (req.method === "POST") {
    const { target_id, note } = req.body ?? {};
    if (!target_id) return res.status(400).json({ error: "target_id is required." });

    // Window must be open (and not new-only for existing students)
    const { data: config } = await adminSupabase
      .from("system_config").select("section_window_open, section_window_new_only").eq("id", 1).single();
    if (!config?.section_window_open) return res.status(403).json({ error: "Section window is closed." });
    if (config?.section_window_new_only && me.assigned_section_id) {
      return res.status(403).json({ error: "Section window is open for new students only." });
    }

    if (!me.assigned_section_id) return res.status(400).json({ error: "You must have a section before swapping." });

    // Load target student
    const { data: target } = await adminSupabase
      .from("students").select("id, assigned_section_id, chosen_specialization_id").eq("id", target_id).maybeSingle();
    if (!target) return res.status(404).json({ error: "Target student not found." });
    if (!target.assigned_section_id) return res.status(400).json({ error: "That student hasn't selected a section yet." });
    if (target.assigned_section_id === me.assigned_section_id) return res.status(400).json({ error: "You're already in the same section." });
    if (target.chosen_specialization_id !== me.chosen_specialization_id) return res.status(400).json({ error: "You can only swap within the same specialization." });

    // No duplicate pending requests
    const { count } = await adminSupabase
      .from("swap_requests").select("id", { count: "exact", head: true })
      .eq("requester_id", me.id).eq("status", "PENDING");
    if ((count ?? 0) > 0) return res.status(409).json({ error: "You already have a pending swap request." });

    const { data: created, error } = await adminSupabase
      .from("swap_requests").insert({
        requester_id: me.id,
        target_id,
        requester_section_id: me.assigned_section_id,
        target_section_id: target.assigned_section_id,
        note: note?.trim() || null,
      }).select().single();
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(201).json({ ok: true, data: created });
  }

  // ── PUT — accept / reject / cancel ────────────────────────────
  if (req.method === "PUT") {
    const { id, action } = req.body ?? {};
    if (!id || !["accept", "reject", "cancel"].includes(action)) {
      return res.status(400).json({ error: "id and action (accept|reject|cancel) are required." });
    }

    const { data: swapReq } = await adminSupabase
      .from("swap_requests").select("*").eq("id", id).maybeSingle();
    if (!swapReq) return res.status(404).json({ error: "Swap request not found." });
    if (swapReq.status !== "PENDING") return res.status(409).json({ error: "This request is no longer pending." });

    // Window check
    const { data: config } = await adminSupabase
      .from("system_config").select("section_window_open").eq("id", 1).single();
    if (!config?.section_window_open) return res.status(403).json({ error: "Section window is closed." });

    if (action === "cancel") {
      if (swapReq.requester_id !== me.id) return res.status(403).json({ error: "Only the requester can cancel." });
      await adminSupabase.from("swap_requests").update({ status: "CANCELLED", resolved_at: new Date().toISOString() }).eq("id", id);
      return res.status(200).json({ ok: true });
    }

    if (action === "reject") {
      if (swapReq.target_id !== me.id) return res.status(403).json({ error: "Only the target can reject." });
      await adminSupabase.from("swap_requests").update({ status: "REJECTED", resolved_at: new Date().toISOString() }).eq("id", id);
      return res.status(200).json({ ok: true });
    }

    if (action === "accept") {
      if (swapReq.target_id !== me.id) return res.status(403).json({ error: "Only the target can accept." });

      // Load both students fresh for section swap
      const [{ data: requester }, { data: targetStu }] = await Promise.all([
        adminSupabase.from("students").select("id, assigned_section_id, assigned_seat, group_number").eq("id", swapReq.requester_id).maybeSingle(),
        adminSupabase.from("students").select("id, assigned_section_id, assigned_seat, group_number").eq("id", swapReq.target_id).maybeSingle(),
      ]);
      if (!requester?.assigned_section_id || !targetStu?.assigned_section_id) {
        return res.status(400).json({ error: "One of the students no longer has a section." });
      }

      // Atomically swap sections, seats, and groups
      await Promise.all([
        adminSupabase.from("students").update({
          assigned_section_id: targetStu.assigned_section_id,
          assigned_seat: targetStu.assigned_seat,
          group_number: targetStu.group_number,
        }).eq("id", requester.id),
        adminSupabase.from("students").update({
          assigned_section_id: requester.assigned_section_id,
          assigned_seat: requester.assigned_seat,
          group_number: requester.group_number,
        }).eq("id", targetStu.id),
      ]);

      await adminSupabase.from("swap_requests").update({ status: "ACCEPTED", resolved_at: new Date().toISOString() }).eq("id", id);
      // Cancel any other pending requests involving either student
      await adminSupabase.from("swap_requests")
        .update({ status: "CANCELLED", resolved_at: new Date().toISOString() })
        .in("requester_id", [requester.id, targetStu.id])
        .eq("status", "PENDING")
        .neq("id", id);

      return res.status(200).json({ ok: true });
    }
  }

  return res.status(405).json({ error: "Method not allowed." });
}
