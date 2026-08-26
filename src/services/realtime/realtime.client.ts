import { createClient, SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

let client: SupabaseClient | null = null;

// Lazily created so importing this module never throws in environments
// (like unit tests) where Supabase env vars aren't configured.
function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be configured for realtime broadcasts");
    }
    client = createClient(url, key);
  }
  return client;
}

/**
 * Broadcasts a one-off event on a Supabase Realtime channel. Used for
 * per-user push notifications on channel `user:${userId}`.
 */
export async function broadcast(
  channelName: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const supabase = getClient();
  const channel = supabase.channel(channelName);
  try {
    await channel.send({ type: "broadcast", event, payload });
  } finally {
    await supabase.removeChannel(channel);
  }
}
