"""AI question generation with strict validation and fallback bank."""
import os
import json
import hashlib
import random
import logging

from fallback_bank import EN, RO, ALL

logger = logging.getLogger("versus.qgen")

LAZY = ["all of the above", "none of the above", "toate cele de mai sus",
        "niciuna de mai sus", "both a and b", "a and b", "answer above"]


def q_hash(text: str) -> str:
    return hashlib.md5(text.strip().lower().encode("utf-8")).hexdigest()


def validate_question(q) -> bool:
    if not isinstance(q, dict):
        return False
    try:
        question = str(q["question"]).strip()
        options = q["options"]
        ci = q["correct_index"]
        cat = str(q.get("category", "General")).strip()
        diff = str(q.get("difficulty", "medium")).strip().lower()
        expl = str(q.get("explanation", "")).strip()
    except (KeyError, TypeError):
        return False
    if not question or len(question) > 120:
        return False
    if not isinstance(options, list) or len(options) != 4:
        return False
    clean = [str(o).strip() for o in options]
    if any((not o) or len(o) > 50 for o in clean):
        return False
    if len({o.lower() for o in clean}) != 4:
        return False
    if any(any(l in o.lower() for l in LAZY) for o in clean):
        return False
    if not isinstance(ci, int) or ci < 0 or ci > 3:
        return False
    if diff not in ("easy", "medium", "hard"):
        return False
    if len(expl) > 160:
        return False
    return True


def normalize(q) -> dict:
    options = [str(o).strip() for o in q["options"]]
    correct = options[int(q["correct_index"])]
    # Shuffle so the correct answer isn't always in the same position (option 0 / red).
    order = list(range(4))
    random.shuffle(order)
    shuffled = [options[i] for i in order]
    return {
        "question": str(q["question"]).strip(),
        "options": shuffled,
        "correct_index": shuffled.index(correct),
        "category": str(q.get("category", "General")).strip(),
        "difficulty": str(q.get("difficulty", "medium")).strip().lower(),
        "explanation": str(q.get("explanation", "")).strip(),
        "hash": q_hash(str(q["question"])),
    }


def _parse_json(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1] if "```" in text else text
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip("` \n")
    # try direct
    try:
        data = json.loads(text)
    except Exception:
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1:
            try:
                data = json.loads(text[start:end + 1])
            except Exception:
                return []
        else:
            return []
    if isinstance(data, dict):
        data = data.get("questions") or data.get("items") or []
    return data if isinstance(data, list) else []


QUESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "correct_index": {"type": "integer"},
                    "category": {"type": "string"},
                    "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
                    "explanation": {"type": "string"},
                },
                "required": ["question", "options", "correct_index", "category",
                             "difficulty", "explanation"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["questions"],
    "additionalProperties": False,
}


async def _call_llm(topic, difficulty, count, language):
    import openai

    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not set")

    lang_name = "Romanian" if language == "ro" else "English"
    diff_line = ("a mix of easy, medium and hard" if difficulty == "mixed"
                 else f"{difficulty} difficulty")
    system = (
        "You are a trivia question writer. Every question is factually correct and unambiguous."
    )
    prompt = (
        f"Generate exactly {count} multiple-choice trivia questions about \"{topic}\" "
        f"in {lang_name}, of {diff_line}.\n"
        "Each question needs exactly 4 distinct options (max 50 chars each) and exactly "
        "one correct answer. NEVER use lazy distractors like 'All of the above' or "
        "'None of the above'. Keep everything strictly in " + lang_name + "."
    )

    client = openai.AsyncOpenAI(api_key=key)
    response = await client.chat.completions.create(
        model="gpt-5.4-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "trivia_questions",
                "schema": QUESTION_SCHEMA,
                "strict": True,
            },
        },
    )
    text = response.choices[0].message.content or ""
    data = _parse_json(text)
    if isinstance(data, dict):
        data = data.get("questions", [])
    return data


async def generate_questions(topic, difficulty, num, language, exclude_hashes=None):
    exclude = set(exclude_hashes or [])
    collected = []
    seen = set(exclude)
    attempts = 0
    try:
        while len(collected) < num and attempts < 3:
            attempts += 1
            need = num - len(collected)
            raw = await _call_llm(topic, difficulty, max(need, 4), language)
            for item in raw:
                if validate_question(item):
                    n = normalize(item)
                    if n["hash"] not in seen:
                        seen.add(n["hash"])
                        collected.append(n)
                        if len(collected) >= num:
                            break
    except Exception as e:
        logger.warning(f"LLM generation failed: {e}")

    if len(collected) < num:
        pool = (RO if language == "ro" else EN)[:]
        random.shuffle(pool)
        backup = pool + [q for q in ALL]
        for q in backup:
            if len(collected) >= num:
                break
            n = normalize(q)
            if n["hash"] not in seen:
                seen.add(n["hash"])
                collected.append(n)
    return collected[:num]
