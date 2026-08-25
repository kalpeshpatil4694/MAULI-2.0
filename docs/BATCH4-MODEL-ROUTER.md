# Batch 4 — Intelligent Model Router

## Decision flow

Founder/Executive task → capability gate → complexity → risk policy → context fit → quality/speed/cost/reasoning/reliability score → primary model → fallback model → provider adapter → execution.

## Guarantees

- A model that lacks a required capability is not eligible.
- A model with insufficient context capacity is not eligible.
- Restricted models are not eligible for high/critical work.
- Explicit `MAULI_MODEL` configuration remains authoritative for backward compatibility.
- Automatic routing may fall back to the next ranked eligible model after provider/model failure.
- Routing decisions emit `model.routing.*` observer events.
- Provider calls go through the provider adapter contract so future providers do not require core execution rewrites.
- If no eligible model exists, routing fails closed instead of silently selecting an incompatible model.

## Batch boundaries

Batch 4 provides the routing foundation and adapter contract. Batch 5 will add context/headroom inputs. Batch 7 can use recorded routing outcomes for learning. Batch 13 expands the provider set without changing the router contract.
