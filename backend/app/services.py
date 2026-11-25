import re
from functools import lru_cache

import httpx

from .config import settings


VARIANTS = [
    ("Conservative", "Light cleanup while retaining most wording.", "light"),
    ("Balanced", "Remove repetition and tighten verbose instructions.", "medium"),
    ("Aggressive", "Maximize brevity without changing requirements.", "strong"),
]

FILLER_REPLACEMENTS = [
    (r"\bplease\b", ""),
    (r"\b(in order to)\b", "to"),
    (r"\b(due to the fact that)\b", "because"),
    (r"\b(at this point in time)\b", "now"),
    (r"\b(it is important to note that)\b", ""),
    (r"\b(make sure that)\b", "ensure"),
    (r"\b(you should)\b", ""),
    (r"\b(you must)\b", ""),
]


def token_count(text: str) -> int:
    try:
        import tiktoken

        return len(tiktoken.get_encoding("cl100k_base").encode(text))
    except (ImportError, ValueError, RuntimeError):
        return max(1, (len(text) + 3) // 4) if text else 0


def _mask_protected(text: str, spans: list[str]) -> tuple[str, dict[str, str]]:
    substitutions: dict[str, str] = {}
    for index, span in enumerate(sorted(set(spans), key=len, reverse=True)):
        marker = f"__PROTECTED_SPAN_{index}_KEEP_EXACT__"
        text = text.replace(span, marker)
        substitutions[marker] = span
    return text, substitutions


def _restore_protected(text: str, substitutions: dict[str, str]) -> str:
    for marker, span in substitutions.items():
        text = text.replace(marker, span)
    return text


def _rule_compress(text: str, level: str) -> str:
    sentences = re.split(r"(?<=[.!?])\s+|\n+", text)
    seen = set()
    unique = []
    for sentence in sentences:
        compact = re.sub(r"\s+", " ", sentence).strip()
        if not compact:
            continue
        key = re.sub(r"[\W_]+", "", compact.lower())
        if key in seen:
            continue
        seen.add(key)
        unique.append(compact)
    result = "\n".join(unique)
    if level in {"medium", "strong"}:
        for pattern, replacement in FILLER_REPLACEMENTS:
            result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
        result = re.sub(r"\b(really|very|quite|simply|basically|actually)\b", "", result, flags=re.IGNORECASE)
        result = re.sub(r"\s+([,.!?;:])", r"\1", result)
        result = re.sub(r" {2,}", " ", result)
    if level == "strong":
        result = re.sub(r"\b(answer the user's question clearly and accurately)\b", "answer accurately", result, flags=re.IGNORECASE)
        result = re.sub(r"\b(be polite and professional|be courteous, friendly, and respectful)\b", "be polite and professional", result, flags=re.IGNORECASE)
    return result.strip()


async def _llm_compress(prompt: str, model: str, level: str) -> str:
    if not settings.openai_api_key:
        raise RuntimeError("LLM API key is not configured.")
    instructions = {
        "light": "Make only safe, small reductions. Preserve the wording and all requirements.",
        "medium": "Remove redundant instructions and filler, merge equivalent rules, and shorten verbose language.",
        "strong": "Compress aggressively but preserve every distinct requirement, condition, format, and intent.",
    }[level]
    response = await _chat(
        model=model,
        messages=[
            {"role": "system", "content": "You are a precise prompt editor. Return only the revised prompt; never add commentary. Preserve all sentinel tokens exactly and in place."},
            {"role": "user", "content": f"{instructions}\nDo not remove, edit, duplicate, or reorder sentinel tokens such as __PROTECTED_SPAN_0_KEEP_EXACT__.\n\nPROMPT:\n{prompt}"},
        ],
        temperature=0,
    )
    return response


async def generate_variants(prompt: str, spans: list[str], model: str) -> tuple[list[dict], str]:
    masked, substitutions = _mask_protected(prompt, spans)
    use_llm = bool(settings.openai_api_key)
    variants = []
    for index, (name, description, level) in enumerate(VARIANTS):
        if use_llm:
            candidate = await _llm_compress(masked, model, level)
        else:
            candidate = _rule_compress(masked, level)
        candidate = _restore_protected(candidate, substitutions)
        if any(span not in candidate for span in spans):
            raise RuntimeError(f"{name} variant failed protected-span validation; no variant was saved.")
        count = token_count(candidate)
        variants.append({
            "name": name,
            "description": description,
            "prompt": candidate,
            "token_count": count,
            "tokens_saved": max(0, token_count(prompt) - count),
            "compression_pct": max(0, (token_count(prompt) - count) / max(1, token_count(prompt)) * 100),
        })
    return variants, "llm" if use_llm else "rules"


async def _chat(model: str, messages: list[dict], temperature: float, seed: int = 31) -> str:
    headers = {"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"}
    body = {"model": model, "messages": messages, "temperature": temperature, "seed": seed}
    url = f"{settings.openai_base_url.rstrip('/')}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=settings.openai_timeout_seconds) as client:
            response = await client.post(url, headers=headers, json=body)
    except httpx.TimeoutException as exc:
        raise RuntimeError("The configured model API timed out.") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Could not reach the configured model API: {type(exc).__name__}.") from exc
    if response.is_error:
        detail = response.text[:500]
        raise RuntimeError(f"OpenAI-compatible API returned {response.status_code}: {detail}")
    try:
        return response.json()["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("The configured model API returned an unexpected response.") from exc


async def execute_prompt(prompt: str, test_input: str, model: str) -> str:
    if not settings.openai_api_key:
        raise RuntimeError("Set OPENAI_API_KEY in backend/.env to run equivalence tests.")
    return await _chat(
        model=model,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": test_input},
        ],
        temperature=0,
        seed=31,
    )


@lru_cache(maxsize=1)
def _embedding_model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(settings.similarity_model)


def semantic_similarity(first: str, second: str) -> tuple[float, str]:
    try:
        import numpy as np

        model = _embedding_model()
        embeddings = model.encode([first, second], normalize_embeddings=True)
        score = float(np.dot(embeddings[0], embeddings[1]))
        return max(0.0, min(1.0, score)), "sentence-transformers"
    except Exception as exc:
        # A local TF-IDF-like overlap keeps the app usable without model weights.
        first_tokens = set(re.findall(r"\w+", first.lower()))
        second_tokens = set(re.findall(r"\w+", second.lower()))
        union = first_tokens | second_tokens
        score = len(first_tokens & second_tokens) / max(1, len(union))
        return score, f"lexical-fallback ({type(exc).__name__})"


def _numbers(text: str) -> set[str]:
    return set(re.findall(r"(?<!\w)[+-]?\d+(?:[.,]\d+)?%?(?!\w)", text))


def _rule_score(original: str, compressed: str, expected: str) -> float:
    checks: list[bool] = []
    original_numbers = _numbers(original)
    if original_numbers:
        checks.append(original_numbers.issubset(_numbers(compressed)))
    if expected.strip():
        words = [word.lower() for word in re.findall(r"\b[\w'-]{4,}\b", expected)]
        stop = {"should", "would", "could", "their", "there", "about", "explain", "mention"}
        required = set(words) - stop
        if required:
            output_words = set(re.findall(r"\b[\w'-]+\b", compressed.lower()))
            checks.append(len(required & output_words) / len(required) >= 0.5)
        if re.search(r"\b(json|bullet|list|table|markdown)\b", expected, re.I):
            checks.append(bool(re.search(r"[\[\]{}]|^\s*[-*]\s|^\s*\d+[.)]\s", compressed, re.M)))
    return sum(checks) / len(checks) if checks else 1.0


async def compare_outputs(original_prompt: str, compressed_prompt: str, test_cases: list[dict], model: str, spans: list[str]) -> dict:
    comparisons = []
    methods = set()
    for case in test_cases:
        original_output, compressed_output = await _both(
            original_prompt, compressed_prompt, case["input"], model,
        )
        similarity, method = semantic_similarity(original_output, compressed_output)
        methods.add(method)
        rule = _rule_score(original_output, compressed_output, case.get("expected", ""))
        comparisons.append({
            "input": case["input"],
            "expected": case.get("expected", ""),
            "original_output": original_output,
            "compressed_output": compressed_output,
            "embedding_similarity": similarity,
            "rule_score": rule,
            "equivalence_score": similarity * 0.7 + rule * 0.3,
        })
    count = max(1, len(comparisons))
    return {
        "comparisons": comparisons,
        "equivalence_score": sum(item["equivalence_score"] for item in comparisons) / count * 100,
        "rule_score": sum(item["rule_score"] for item in comparisons) / count * 100,
        "similarity_method": ", ".join(sorted(methods)) or "not-run",
    }


async def _both(original: str, compressed: str, user_input: str, model: str) -> tuple[str, str]:
    # Keep execution order stable and send identical settings to each request.
    original_output = await execute_prompt(original, user_input, model)
    compressed_output = await execute_prompt(compressed, user_input, model)
    return original_output, compressed_output
