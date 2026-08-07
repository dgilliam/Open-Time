// Minimal Slack client (v3.9): one POST to chat.postMessage, no SDK — same
// hand-rolled approach as the Google OAuth module. The API base is
// env-overridable so tests point it at a local stub; production never sets
// the override.

/** Slack posting is enabled only when a bot token and a target channel exist. */
export function slackEnabled(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_DIGEST_CHANNEL);
}

function slackApiUrl(): string {
  return process.env.SLACK_API_URL || "https://slack.com/api";
}

/**
 * Posts `text` (Slack mrkdwn) to `channel`. Returns null on success or a
 * short error string on failure — callers log it rather than throwing, since
 * a failed digest must never take down the scheduler or an admin request.
 * Slack signals failures in the JSON body (`ok: false`), not the HTTP status.
 */
export async function postSlackMessage(channel: string, text: string): Promise<string | null> {
  try {
    const res = await fetch(`${slackApiUrl()}/chat.postMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${process.env.SLACK_BOT_TOKEN ?? ""}`,
      },
      body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!json) return `slack returned a non-JSON response (${res.status})`;
    if (!json.ok) return json.error ?? "unknown slack error";
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "slack request failed";
  }
}
