# Sample outputs

These are hand-crafted samples the mock generator returns during local-only development. Each demonstrates the prompt's expected output shape for a different scenario.

---

## Sample 1: Always Sunny, difficulty 5, multiple choice, count 5

**Input:**
```json
{
  "topic": "It's Always Sunny in Philadelphia",
  "difficulty": 5,
  "format": "multiple_choice",
  "count": 5
}
```

**Output:**
```json
{
  "topic_interpretation": "It's Always Sunny in Philadelphia, the FX/FXX sitcom (2005-present) about the gang at Paddy's Pub.",
  "topic_safe": true,
  "rejection_reason": null,
  "questions": [
    {
      "question": "What is the name of the bar the gang owns?",
      "correct_answer": "Paddy's Pub",
      "answer_aliases": ["Paddy's", "Paddy's Irish Pub"],
      "distractors": ["McGinty's", "Murphy's Tavern", "The Black Cat"],
      "source_hint": "Established in the pilot, Season 1 Episode 1.",
      "type": "factual",
      "per_question_format": "multiple_choice"
    },
    {
      "question": "What does the 'D' in Dennis's D.E.N.N.I.S. System stand for?",
      "correct_answer": "Demonstrate value",
      "answer_aliases": ["Demonstrate Value"],
      "distractors": ["Define limits", "Disarm with charm", "Detach emotionally"],
      "source_hint": "Season 5 Episode 10, 'The D.E.N.N.I.S. System.'",
      "type": "factual",
      "per_question_format": "multiple_choice"
    },
    {
      "question": "What is the title of Charlie's rock opera that the gang stages at Paddy's?",
      "correct_answer": "The Nightman Cometh",
      "answer_aliases": ["Nightman Cometh", "The Nightman"],
      "distractors": ["The Dayman Awakens", "Kitten Mittens: The Musical", "Dennis's Dance"],
      "source_hint": "Season 4 finale, episode title.",
      "type": "factual",
      "per_question_format": "multiple_choice"
    },
    {
      "question": "Who plays Frank Reynolds?",
      "correct_answer": "Danny DeVito",
      "answer_aliases": ["DeVito"],
      "distractors": ["Joe Pesci", "Bob Saget", "Christopher Lloyd"],
      "source_hint": "Joined the main cast in Season 2.",
      "type": "factual",
      "per_question_format": "multiple_choice"
    },
    {
      "question": "What food does Charlie famously order on a date in 'The Waitress is Getting Married'?",
      "correct_answer": "Milk steak",
      "answer_aliases": ["milksteak"],
      "distractors": ["Raw chicken", "Cat food souffle", "Glue casserole"],
      "source_hint": "Season 5 Episode 5, 'The Waitress is Getting Married.'",
      "type": "factual",
      "per_question_format": "multiple_choice"
    }
  ]
}
```

---

## Sample 2: Python programming, difficulty 8, free text, count 3

**Input:**
```json
{
  "topic": "Python programming",
  "difficulty": 8,
  "format": "free_text",
  "count": 3
}
```

**Output:**
```json
{
  "topic_interpretation": "The Python programming language — core language features, standard library, and CPython implementation details.",
  "topic_safe": true,
  "rejection_reason": null,
  "questions": [
    {
      "question": "What special method must a class implement to be usable as a context manager via the `with` statement, in addition to `__enter__`?",
      "correct_answer": "__exit__",
      "answer_aliases": ["__exit__()", "dunder exit", "exit"],
      "distractors": [],
      "source_hint": "PEP 343, Python data model documentation.",
      "type": "factual",
      "per_question_format": "free_text"
    },
    {
      "question": "What is the name of CPython's mechanism that prevents multiple native threads from executing Python bytecode simultaneously?",
      "correct_answer": "Global Interpreter Lock",
      "answer_aliases": ["GIL", "the GIL", "global interpreter lock"],
      "distractors": [],
      "source_hint": "Core CPython implementation detail; removable as of PEP 703 (3.13+).",
      "type": "factual",
      "per_question_format": "free_text"
    },
    {
      "question": "Which built-in decorator turns a method into a class-level attribute that is computed once and cached on the instance?",
      "correct_answer": "functools.cached_property",
      "answer_aliases": ["cached_property", "@cached_property", "functools.cached_property()"],
      "distractors": [],
      "source_hint": "Added in Python 3.8, functools module.",
      "type": "factual",
      "per_question_format": "free_text"
    }
  ]
}
```

---

## Sample 3: Ambiguous topic — "Friends", difficulty 4, mixed, count 4

**Input:**
```json
{
  "topic": "Friends",
  "difficulty": 4,
  "format": "mixed",
  "count": 4
}
```

**Output (model picks most common meaning, echoes it):**
```json
{
  "topic_interpretation": "Friends, the NBC sitcom (1994-2004) about six friends living in Manhattan. (If you meant graph theory or another meaning, cancel and re-specify.)",
  "topic_safe": true,
  "rejection_reason": null,
  "questions": [
    {
      "question": "What is the name of the coffee shop the friends frequent?",
      "correct_answer": "Central Perk",
      "answer_aliases": ["Central Perk Coffee"],
      "distractors": ["Central Park", "The Coffee Bean", "Java House"],
      "source_hint": "Recurring set, established Season 1 Episode 1.",
      "type": "factual",
      "per_question_format": "multiple_choice"
    },
    {
      "question": "What is the name of Ross's pet monkey?",
      "correct_answer": "Marcel",
      "answer_aliases": [],
      "distractors": [],
      "source_hint": "Ross's pet from Season 1.",
      "type": "factual",
      "per_question_format": "free_text"
    },
    {
      "question": "Which character's last name is Tribbiani?",
      "correct_answer": "Joey",
      "answer_aliases": ["Joey Tribbiani"],
      "distractors": ["Chandler", "Ross", "Phoebe"],
      "source_hint": "Main character throughout the series.",
      "type": "identification",
      "per_question_format": "multiple_choice"
    },
    {
      "question": "What is the name of Phoebe's twin sister?",
      "correct_answer": "Ursula",
      "answer_aliases": ["Ursula Buffay"],
      "distractors": [],
      "source_hint": "Recurring character; first appeared in 'The One With Two Parts.'",
      "type": "factual",
      "per_question_format": "free_text"
    }
  ]
}
```

---

## Sample 4: Refusal — too vague

**Input:**
```json
{
  "topic": "stuff",
  "difficulty": 5,
  "format": "multiple_choice",
  "count": 10
}
```

**Output:**
```json
{
  "topic_interpretation": "The topic 'stuff' is too vague to generate calibrated trivia.",
  "topic_safe": true,
  "rejection_reason": "topic too vague — please be more specific (e.g. a TV show, a sport, a historical era, a video game)",
  "questions": []
}
```

---

## Sample 6: Difficulty capped — niche topic at D9

**Input:**
```json
{
  "topic": "Pony Island (2016 indie video game)",
  "difficulty": 9,
  "format": "multiple_choice",
  "count": 5
}
```

**Output (model knows the game generally but not at expert depth, caps to D5):**
```json
{
  "topic_interpretation": "Pony Island, the 2016 indie meta-puzzle game by Daniel Mullins.",
  "topic_safe": true,
  "rejection_reason": null,
  "difficulty_delivered": 5,
  "knowledge_warning": "My knowledge of Pony Island is general-fan level, not expert. Questions calibrated to D5 (recognizable themes and mechanics) rather than D9 (frame-specific gags or dev trivia).",
  "questions": [
    {
      "question": "Who developed Pony Island?",
      "correct_answer": "Daniel Mullins",
      "answer_aliases": ["Daniel Mullins Games", "Mullins"],
      "distractors": ["Toby Fox", "Edmund McMillen", "Lucas Pope"],
      "source_hint": "Game credits; also developer of Inscryption.",
      "type": "factual",
      "per_question_format": "multiple_choice"
    },
    {
      "question": "What is the central antagonist of Pony Island?",
      "correct_answer": "Lucifer",
      "answer_aliases": ["the devil", "Satan", "L.U.C.I.F.E.R."],
      "distractors": ["A rogue AI", "Your reflection", "An ancient pony king"],
      "source_hint": "Established within the first hour of play.",
      "type": "factual",
      "per_question_format": "multiple_choice"
    }
  ]
}
```

Note: only 2 questions returned instead of 5 — model preferred fewer accurate questions over filling the quota with weak ones. The UI should surface this gracefully.

---

## Sample 5: Refusal — unsafe

**Input:**
```json
{
  "topic": "how to make a pipe bomb",
  "difficulty": 5,
  "format": "multiple_choice",
  "count": 10
}
```

**Output:**
```json
{
  "topic_interpretation": "Refused — request for operational instructions on a weapon.",
  "topic_safe": false,
  "rejection_reason": "Topic involves operational instructions for weapons or violence.",
  "questions": []
}
```
