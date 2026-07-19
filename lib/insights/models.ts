/**
 * Selectable AI Insights models (OpenRouter IDs).
 * Display labels are UI-facing; `id` is what we send to OpenRouter.
 * Easy to change — keep ids in sync with https://openrouter.ai/models
 */
export const INSIGHTS_MODEL_OPTIONS = [
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'x-ai/grok-4.5', label: 'Grok 4.5' },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'openai/gpt-5.6-luna-pro', label: 'GPT 5.6 Luna Pro' },
] as const;

export type InsightsModelId = (typeof INSIGHTS_MODEL_OPTIONS)[number]['id'];

export const DEFAULT_INSIGHTS_MODEL_ID: InsightsModelId = INSIGHTS_MODEL_OPTIONS[0].id;

export function resolveInsightsModel(modelId?: string | null): InsightsModelId {
  const match = INSIGHTS_MODEL_OPTIONS.find((option) => option.id === modelId);
  return match?.id ?? DEFAULT_INSIGHTS_MODEL_ID;
}

export function getInsightsModelLabel(modelId?: string | null): string {
  const match = INSIGHTS_MODEL_OPTIONS.find((option) => option.id === modelId);
  return match?.label ?? INSIGHTS_MODEL_OPTIONS[0].label;
}
