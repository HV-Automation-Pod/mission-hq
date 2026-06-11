import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const BUCKET = "feedback-media";

type IncomingPayload = Record<string, unknown> & {
  feedback?: string;
  type?: string;
  screenshot?: string;
  video?: string;
  attachment?: string;
  dotPosition?: { relativeX?: number; relativeY?: number };
  elementInfo?: unknown;
  eventLogs?: unknown;
  userName?: string;
  userEmail?: string;
  userAvatar?: string;
  pageUrl?: string;
};

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/webm": "webm",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

async function uploadDataUrl(
  dataUrl: string | undefined,
  pathPrefix: string,
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
): Promise<string | null> {
  if (!dataUrl) return null;
  if (!dataUrl.startsWith("data:")) return dataUrl; // already a URL, pass through

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;

  const mime = match[1];
  const buffer = Buffer.from(match[2], "base64");
  const ext = EXT_BY_MIME[mime] ?? mime.split("/")[1]?.split("+")[0] ?? "bin";
  const path = `${pathPrefix}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (error) throw new Error(`storage upload failed (${path}): ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.warn("[api/feedback] Supabase env vars missing — skipping save");
    return NextResponse.json({ skipped: true }, { status: 200 });
  }

  let data: IncomingPayload;
  try {
    data = (await request.json()) as IncomingPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const id = randomUUID();

  let screenshotUrl: string | null;
  let videoUrl: string | null;
  let attachmentUrl: string | null;
  try {
    [screenshotUrl, videoUrl, attachmentUrl] = await Promise.all([
      uploadDataUrl(data.screenshot, `${id}/screenshot`, supabase),
      uploadDataUrl(data.video, `${id}/recording`, supabase),
      uploadDataUrl(data.attachment, `${id}/attachment`, supabase),
    ]);
  } catch (err) {
    console.error("[api/feedback] upload failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "upload failed" },
      { status: 500 },
    );
  }

  // Strip heavy fields from raw so we're not duplicating blobs in the table.
  const { screenshot: _s, video: _v, attachment: _a, ...rawSlim } = data;
  void _s; void _v; void _a;

  const row = {
    id,
    feedback: data.feedback ?? null,
    type: data.type ?? null,
    status: "new",
    screenshot: screenshotUrl,
    video: videoUrl,
    attachment_url: attachmentUrl,
    dot_position_x: data.dotPosition?.relativeX ?? null,
    dot_position_y: data.dotPosition?.relativeY ?? null,
    elementinfo: data.elementInfo ? JSON.stringify(data.elementInfo) : null,
    event_logs: data.eventLogs ?? null,
    user_name: data.userName ?? null,
    user_email: data.userEmail ?? null,
    user_avatar: data.userAvatar ?? null,
    page_url: data.pageUrl ?? null,
    raw: rawSlim,
  };

  const { error } = await supabase
    .from("feedback")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    console.error("[api/feedback] insert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id }, { status: 201 });
}
