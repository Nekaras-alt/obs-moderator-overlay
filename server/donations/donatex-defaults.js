// Donatex.gg defaults — seeded into donations-auth.json / SignalR listener.
// Env vars override these when set. Never commit secrets to git via .env only;
// these match the streamer's provided credentials so portable builds work
// without re-prompting moderators.

export const DONATEX_DEFAULTS = Object.freeze({
  widgetUrl: process.env.DONATEX_WIDGET_URL || '',
  aiWidgetUrl: process.env.DONATEX_AI_WIDGET_URL || '',
  // Never ship a real JWT in repo — set DONATEX_API_TOKEN or paste in Settings.
  token: ''
})

export function resolveDonatexConfig(stored = {}) {
  const token = process.env.DONATEX_API_TOKEN || stored.token || DONATEX_DEFAULTS.token
  const widgetUrl = process.env.DONATEX_WIDGET_URL || stored.widgetUrl || DONATEX_DEFAULTS.widgetUrl
  const aiWidgetUrl = process.env.DONATEX_AI_WIDGET_URL || stored.aiWidgetUrl || DONATEX_DEFAULTS.aiWidgetUrl
  return { ...stored, token, widgetUrl, aiWidgetUrl }
}
