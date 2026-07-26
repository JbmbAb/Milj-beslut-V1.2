"""Prompt variant generation for AlphaEvolve-style search over rerank templates."""

from __future__ import annotations

from rerank_client import DEFAULT_TEMPLATE

# Seed templates cycled when ``max_iterations`` exceeds explicit seeds.
DEFAULT_VARIANT_SEEDS: tuple[str, ...] = (
    DEFAULT_TEMPLATE,
    (
        'Du är en svensk miljöexpert. Rangordna dokumenten strikt baserat på '
        'geografisk närhet, juridisk relevans och miljörelevans för frågan: "{{QUERY}}".\n'
        'Returnera JSON-array [{"id":"...","score":0.0-1.0}].\n\nDokumentavsnitt:\n{{DOCUMENTS}}'
    ),
    (
        'System: Rangordna följande svenska miljö- och geodatakontext. '
        'Prioritera direkta träffar mot sökfrågan: "{{QUERY}}".\n'
        'JSON-format: [{"id":"...","score":0.95}]\n\n{{DOCUMENTS}}'
    ),
    (
        'Rank the following Swedish environmental geodata contexts for query "{{QUERY}}". '
        'Prioritize direct feature matches, legal references, and proximity.\n'
        'Output JSON only.\n\n{{DOCUMENTS}}'
    ),
)


def build_variants(base_template: str, max_iterations: int) -> list[tuple[str, str]]:
    """Return ``(variant_id, template)`` pairs for the optimization loop.

    Args:
        base_template: Optional override for the first seed; falls back to
            ``DEFAULT_TEMPLATE`` when empty.
        max_iterations: Number of variants to evaluate (cycles seeds if larger).

    Returns:
        List of ``(variant_id, prompt_template)`` tuples, e.g. ``("v1", "...")``.
    """
    seeds = list(DEFAULT_VARIANT_SEEDS)
    if base_template:
        seeds[0] = base_template
    elif not seeds[0]:
        seeds[0] = DEFAULT_TEMPLATE

    return [(f'v{i + 1}', seeds[i % len(seeds)]) for i in range(max_iterations)]
