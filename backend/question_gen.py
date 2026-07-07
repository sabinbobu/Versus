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
    return {
        "question": str(q["question"]).strip(),
        "options": [str(o).strip() for o in q["options"]],
        "correct_index": int(q["correct_index"]),
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


async def _call_llm(topic, difficulty, count, language):
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    lang_name = "Romanian" if language == "ro" else "English"
    diff_line = ("a mix of easy, medium and hard" if difficulty == "mixed"
                 else f"{difficulty} difficulty")
    system = (
        "You are a trivia question writer. You output ONLY valid JSON, no prose. "
        "Every question is factually correct and unambiguous."
    )
    prompt = (
        f"Generate exactly {count} multiple-choice trivia questions about \"{topic}\" "
        f"in {lang_name}, of {diff_line}.\n"
        "Return a JSON array. Each element must be an object with EXACTLY these keys:\n"
        '{"question": string (max 120 chars), "options": array of 4 distinct strings '
        '(each max 50 chars), "correct_index": integer 0-3, "category": string, '
        '"difficulty": "easy"|"medium"|"hard", "explanation": string (max 160 chars)}\n'
        "Rules: exactly 4 options, all distinct, exactly one correct. "
        "NEVER use lazy distractors like 'All of the above' or 'None of the above'. "
        "Keep everything strictly in " + lang_name + ". Output only the JSON array."
    )
    chat = LlmChat(api_key=key, session_id=f"qgen-{random.randint(1, 1_000_000)}",
                   system_message=system).with_model("openai", "gpt-5.5")
    resp = await chat.send_message(UserMessage(text=prompt))
    text = resp if isinstance(resp, str) else str(resp)
    return _parse_json(text)


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
