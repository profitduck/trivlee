import "server-only";
import type {
  ChallengeFormat,
  GeneratedQuestion,
  GenerationRequest,
  GenerationResponse,
  PerQuestionFormat,
} from "./types";

// Mock generator. Returns hand-crafted responses for known topics and a
// clearly-labelled synthetic response for unknown ones. Mirrors the schema
// the real Claude-backed generator will produce so callers don't change.

export async function mockGenerate(
  req: GenerationRequest
): Promise<GenerationResponse> {
  const start = performance.now();

  // Simulate realistic latency.
  await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));

  const topic = req.topic.trim();
  const lc = topic.toLowerCase();

  // Safety stub — refuse the obvious cases.
  if (matchesAny(lc, ["pipe bomb", "how to make a weapon", "csam", "child porn"])) {
    return refusal(req, "Topic involves operational instructions for violence or illegal content.", start);
  }

  // Too vague.
  if (lc === "stuff" || lc === "things" || lc.length < 3) {
    return softRefusal(
      req,
      "topic too vague — please be more specific (e.g. a TV show, a sport, a video game)",
      "The topic is too vague to generate calibrated trivia.",
      start
    );
  }

  // Canned topics.
  if (matchesAny(lc, ["always sunny", "sunny in philadelphia", "paddy's pub"])) {
    return sunnyResponse(req, start);
  }
  if (matchesAny(lc, ["python", "cpython"])) {
    return pythonResponse(req, start);
  }
  if (matchesAny(lc, ["friends sitcom", "friends nbc", "friends tv", "central perk"]) ||
      lc === "friends") {
    return friendsResponse(req, start);
  }

  // Generic fallback — synthetic but structurally valid.
  return genericResponse(req, start);
}

// ---------- helpers ----------

function matchesAny(s: string, needles: string[]): boolean {
  return needles.some((n) => s.includes(n));
}

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}

function take<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

function inferPerQuestionFormat(
  format: ChallengeFormat,
  index: number
): PerQuestionFormat {
  if (format === "multiple_choice") return "multiple_choice";
  if (format === "free_text") return "free_text";
  return index % 2 === 0 ? "multiple_choice" : "free_text";
}

function stripDistractorsForFormat(
  questions: GeneratedQuestion[],
  format: ChallengeFormat
): GeneratedQuestion[] {
  return questions.map((q, i) => {
    const pqf = inferPerQuestionFormat(format, i);
    return {
      ...q,
      per_question_format: pqf,
      distractors: pqf === "free_text" ? [] : q.distractors,
    };
  });
}

function refusal(req: GenerationRequest, reason: string, start: number): GenerationResponse {
  return {
    topic_interpretation: `Refused: ${req.topic}.`,
    topic_safe: false,
    rejection_reason: reason,
    difficulty_delivered: req.difficulty,
    knowledge_warning: null,
    questions: [],
    meta: { generated_by: "mock", latency_ms: elapsed(start) },
  };
}

function softRefusal(
  req: GenerationRequest,
  reason: string,
  interpretation: string,
  start: number
): GenerationResponse {
  return {
    topic_interpretation: interpretation,
    topic_safe: true,
    rejection_reason: reason,
    difficulty_delivered: req.difficulty,
    knowledge_warning: null,
    questions: [],
    meta: { generated_by: "mock", latency_ms: elapsed(start) },
  };
}

// ---------- canned: Always Sunny ----------

const SUNNY_QUESTIONS: GeneratedQuestion[] = [
  {
    question: "What is the name of the bar the gang owns?",
    correct_answer: "Paddy's Pub",
    answer_aliases: ["Paddy's", "Paddy's Irish Pub"],
    distractors: ["McGinty's", "Murphy's Tavern", "The Black Cat"],
    source_hint: "Established in the pilot, Season 1 Episode 1.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "What does the 'D' in Dennis's D.E.N.N.I.S. System stand for?",
    correct_answer: "Demonstrate value",
    answer_aliases: ["demonstrate value"],
    distractors: ["Define limits", "Disarm with charm", "Detach emotionally"],
    source_hint: "Season 5 Episode 10, 'The D.E.N.N.I.S. System.'",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "What is the title of Charlie's rock opera staged at Paddy's?",
    correct_answer: "The Nightman Cometh",
    answer_aliases: ["Nightman Cometh", "The Nightman"],
    distractors: ["The Dayman Awakens", "Kitten Mittens: The Musical", "Dennis's Dance"],
    source_hint: "Season 4 finale.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "Who plays Frank Reynolds?",
    correct_answer: "Danny DeVito",
    answer_aliases: ["DeVito"],
    distractors: ["Joe Pesci", "Bob Saget", "Christopher Lloyd"],
    source_hint: "Joined the main cast in Season 2.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "What unusual food does Charlie order on a date in 'The Waitress is Getting Married'?",
    correct_answer: "Milk steak",
    answer_aliases: ["milksteak", "milk-steak"],
    distractors: ["Raw chicken", "Cat food souffle", "Glue casserole"],
    source_hint: "Season 5 Episode 5.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "What is Dee Reynolds's full first name?",
    correct_answer: "Deandra",
    answer_aliases: ["Deandra Reynolds"],
    distractors: ["Diana", "Delilah", "Daphne"],
    source_hint: "Referenced repeatedly across early seasons.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "What product does Charlie pitch in his famous fake infomercial?",
    correct_answer: "Kitten Mittens",
    answer_aliases: ["kitten mittons"],
    distractors: ["Rat Pajamas", "Dog Goggles", "Bird Bibs"],
    source_hint: "Season 5 Episode 8.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "What is Rickety Cricket's profession before the gang ruins his life?",
    correct_answer: "Catholic priest",
    answer_aliases: ["priest", "Catholic", "a priest"],
    distractors: ["High school teacher", "Lawyer", "Doctor"],
    source_hint: "Established Season 2, returns throughout the series.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "Name the two primary McPoyle brothers.",
    correct_answer: "Liam and Ryan",
    answer_aliases: ["Liam McPoyle and Ryan McPoyle", "Ryan and Liam"],
    distractors: ["Pete and Roy", "Sean and Colin", "Patrick and Brendan"],
    source_hint: "Recurring antagonists since Season 1.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "In 'A Very Sunny Christmas', what shocking thing does Frank do at a department store?",
    correct_answer: "Emerges naked from inside a leather couch",
    answer_aliases: ["emerges naked from a couch", "comes out of a couch naked", "naked from a couch"],
    distractors: [
      "Fights Santa Claus on the roof",
      "Sets fire to the Christmas tree",
      "Steals a sleigh full of gifts",
    ],
    source_hint: "Season 6 special, 'A Very Sunny Christmas.'",
    type: "factual",
    per_question_format: "multiple_choice",
  },
];

function sunnyResponse(req: GenerationRequest, start: number): GenerationResponse {
  const questions = take(stripDistractorsForFormat(SUNNY_QUESTIONS, req.format), req.count);
  return {
    topic_interpretation:
      "It's Always Sunny in Philadelphia, the FX/FXX sitcom (2005-present) about the gang at Paddy's Pub.",
    topic_safe: true,
    rejection_reason: null,
    difficulty_delivered: req.difficulty,
    knowledge_warning: null,
    questions,
    meta: { generated_by: "mock", latency_ms: elapsed(start) },
  };
}

// ---------- canned: Python ----------

const PYTHON_QUESTIONS: GeneratedQuestion[] = [
  {
    question: "What special method must a class implement to be a context manager via 'with', in addition to __enter__?",
    correct_answer: "__exit__",
    answer_aliases: ["__exit__()", "dunder exit", "exit"],
    distractors: ["__close__", "__finally__", "__release__"],
    source_hint: "PEP 343.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "What is CPython's mechanism that prevents multiple native threads from executing Python bytecode simultaneously?",
    correct_answer: "Global Interpreter Lock",
    answer_aliases: ["GIL", "the GIL"],
    distractors: ["Thread Affinity Lock", "Bytecode Mutex", "Cython Lock"],
    source_hint: "Core CPython detail; removable in 3.13+ via PEP 703.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "Which built-in decorator caches a method's return value on the instance?",
    correct_answer: "functools.cached_property",
    answer_aliases: ["cached_property", "@cached_property"],
    distractors: ["@property", "@lru_cache", "@staticmethod"],
    source_hint: "Added in Python 3.8.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "What does the walrus operator (:=) do?",
    correct_answer: "Assigns a value as part of an expression",
    answer_aliases: ["assignment expression", "inline assignment"],
    distractors: [
      "Performs floor division",
      "Defines a default argument",
      "Unpacks a dictionary",
    ],
    source_hint: "PEP 572, added in Python 3.8.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "What's the default port used by python -m http.server with no arguments?",
    correct_answer: "8000",
    answer_aliases: ["port 8000"],
    distractors: ["80", "8080", "3000"],
    source_hint: "Standard library default.",
    type: "numeric",
    per_question_format: "multiple_choice",
  },
];

function pythonResponse(req: GenerationRequest, start: number): GenerationResponse {
  const questions = take(stripDistractorsForFormat(PYTHON_QUESTIONS, req.format), req.count);
  return {
    topic_interpretation:
      "The Python programming language — core language features, standard library, and CPython.",
    topic_safe: true,
    rejection_reason: null,
    difficulty_delivered: req.difficulty,
    knowledge_warning: null,
    questions,
    meta: { generated_by: "mock", latency_ms: elapsed(start) },
  };
}

// ---------- canned: Friends ----------

const FRIENDS_QUESTIONS: GeneratedQuestion[] = [
  {
    question: "What is the name of the coffee shop the friends frequent?",
    correct_answer: "Central Perk",
    answer_aliases: ["Central Perk Coffee"],
    distractors: ["Central Park", "The Coffee Bean", "Java House"],
    source_hint: "Recurring set, Season 1 Episode 1.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "What is the name of Ross's pet monkey?",
    correct_answer: "Marcel",
    answer_aliases: [],
    distractors: ["Mojo", "Curious George", "Banana"],
    source_hint: "Season 1.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "Which character's last name is Tribbiani?",
    correct_answer: "Joey",
    answer_aliases: ["Joey Tribbiani"],
    distractors: ["Chandler", "Ross", "Phoebe"],
    source_hint: "Main character throughout.",
    type: "identification",
    per_question_format: "multiple_choice",
  },
  {
    question: "What is the name of Phoebe's twin sister?",
    correct_answer: "Ursula",
    answer_aliases: ["Ursula Buffay"],
    distractors: ["Estelle", "Janice", "Carol"],
    source_hint: "Recurring character.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
  {
    question: "What is the name of Chandler's stripper bride in Las Vegas?",
    correct_answer: "He doesn't marry one — Ross and Rachel do",
    answer_aliases: ["nobody", "trick question", "Ross and Rachel"],
    distractors: ["Janice", "Kathy", "Aurora"],
    source_hint: "Season 5 finale: Ross and Rachel get drunk-married.",
    type: "factual",
    per_question_format: "multiple_choice",
  },
];

function friendsResponse(req: GenerationRequest, start: number): GenerationResponse {
  const questions = take(stripDistractorsForFormat(FRIENDS_QUESTIONS, req.format), req.count);
  return {
    topic_interpretation:
      "Friends, the NBC sitcom (1994-2004) about six friends in Manhattan. (If you meant graph theory, cancel and re-specify.)",
    topic_safe: true,
    rejection_reason: null,
    difficulty_delivered: req.difficulty,
    knowledge_warning: null,
    questions,
    meta: { generated_by: "mock", latency_ms: elapsed(start) },
  };
}

// ---------- generic fallback ----------

function genericResponse(req: GenerationRequest, start: number): GenerationResponse {
  const stub: GeneratedQuestion[] = Array.from({ length: req.count }, (_, i) => ({
    question: `[MOCK] Sample question ${i + 1} about "${req.topic}" at difficulty ${req.difficulty}.`,
    correct_answer: `Mock answer ${i + 1}`,
    answer_aliases: [`mock ${i + 1}`, `answer ${i + 1}`],
    distractors: ["Mock distractor A", "Mock distractor B", "Mock distractor C"],
    source_hint: "Mock data — wire USE_MOCK_AI=false to call the real model.",
    type: "factual",
    per_question_format: inferPerQuestionFormat(req.format, i),
  }));

  return {
    topic_interpretation: `Mock interpretation of "${req.topic}". Real generation is disabled.`,
    topic_safe: true,
    rejection_reason: null,
    difficulty_delivered: req.difficulty,
    knowledge_warning:
      "Running with USE_MOCK_AI=true. These questions are placeholders. Try 'Always Sunny', 'Python', or 'Friends' for richer canned content, or set USE_MOCK_AI=false with an Anthropic key to get real questions.",
    questions: stripDistractorsForFormat(stub, req.format),
    meta: { generated_by: "mock", latency_ms: elapsed(start) },
  };
}
