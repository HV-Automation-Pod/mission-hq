import { NextResponse } from "next/server";
import axios from "axios";

export async function GET() {
  const API_URL = process.env.API_URL;
  if (!API_URL) {
    return NextResponse.json({ success: false, error: "API_URL not configured" }, { status: 500 });
  }

  try {
    const { data } = await axios.get(API_URL, {
      params: { action: "all" },
      maxRedirects: 5,
    });

    if (!data.success) {
      return NextResponse.json({ success: false, error: "Upstream API returned failure" }, { status: 502 });
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
