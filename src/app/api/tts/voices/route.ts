import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Server-side proxy so the ElevenLabs API key never reaches the browser.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  if (process.env.TTS_ENABLED !== "true") {
    return NextResponse.json({ error: "AI voiceover isn't available right now." }, { status: 403 });
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: "Voiceover isn't configured yet." }, { status: 500 });
  }

  const res = await fetch(`${process.env.ELEVENLABS_API_URL ?? "https://api.elevenlabs.io"}/v1/voices`, {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Could not load voices." }, { status: 502 });
  }

  const json = (await res.json()) as { voices?: { voice_id: string; name: string }[] };
  const voices = (json.voices ?? []).map((v) => ({ voice_id: v.voice_id, name: v.name }));
  return NextResponse.json({ voices });
}
