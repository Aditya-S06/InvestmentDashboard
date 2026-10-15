"""Versioned, non-secret Desk execution policy (stdlib only)."""
VERSION = 1
BUDGETS = {'fast': 300, 'standard': 600, 'deep': 900}
TOOL_ROUNDS = {'fast': 3, 'standard': 5, 'deep': 8}
SPEND_USD = {'fast': .50, 'standard': 1., 'deep': 2.}
MAX_ATTEMPTS = {'fast': 32, 'standard': 56, 'deep': 80}
OUTPUT_TOKENS = {'quick': 4096, 'deep': 8192, 'memory': 1024}
REQUEST_SECONDS = {'quick': 45, 'deep': 90, 'memory': 20}
# Router-enforced ceilings, NOT claimed current model prices ($ / million).
PRICE_CEILINGS = {'quick': (.40, 1.50), 'deep': (.50, 2.50), 'memory': (.40, 1.50)}
MAX_INPUT_BYTES = 128_000
MAX_EVIDENCE_BYTES = 32_000  # conservative token ceiling; no silent table truncation


def config_policy(depth):
    return {'desk_policy_version': VERSION, 'max_tool_rounds': TOOL_ROUNDS[depth],
            'llm_max_retries': 0, 'max_tokens': OUTPUT_TOKENS['quick']}
