"""Seed data for the coding-practice platform (V1).

Five hand-authored problems covering Easy + Medium across diverse DSA topics.
Loaded lazily by `seed_if_empty(db)` on first read — same pattern as
`skill_graph_seed.py`.

Each problem is structured as a `SeedProblem` dataclass for readability;
`seed_if_empty` translates it to `CodingProblem` rows.

Authoring contract (per problem):
- `function_name` is what the user's solution must define.
- `comparator` selects equality mode for the test runner: "exact" | "sorted" | "set".
- `visible_test_cases` are shown in the UI (used by the Run button).
- `hidden_test_cases` are not displayed (used by Submit). NOTE: Pyodide runs
  client-side, so technically the hidden cases are reachable in DevTools.
  Acceptable for V1; V4's Judge0 integration recovers real secrecy.
- `skill_node_names` must match nodes in `skill_graph_seed.SEED_NODES`.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.coding import CodingDifficulty, CodingProblem

logger = logging.getLogger(__name__)


@dataclass
class SeedProblem:
    slug: str
    title: str
    description: str  # markdown
    difficulty: CodingDifficulty
    function_name: str
    function_signature: dict
    examples: list[dict]
    hints: list[str]
    starter_code: dict[str, str]
    reference_solution: dict[str, str]
    visible_test_cases: list[dict]
    hidden_test_cases: list[dict]
    comparator: str = "exact"
    topic_tags: list[str] = field(default_factory=list)
    skill_node_names: list[str] = field(default_factory=list)
    leetcode_url: str | None = None  # canonical LeetCode URL for the redirect


# ────────────────────────────────────────────────────────────────
# Problem 1 — Two Sum
# ────────────────────────────────────────────────────────────────
TWO_SUM = SeedProblem(
    slug="two-sum",
    title="Two Sum",
    difficulty=CodingDifficulty.EASY,
    description="""Given an array of integers `nums` and an integer `target`,
return the **indices** of the two numbers such that they add up to `target`.

You may assume that each input has **exactly one solution**, and you may not
use the same element twice. You can return the answer in any order.

**Constraints**
- `2 <= len(nums) <= 10^4`
- `-10^9 <= nums[i] <= 10^9`
- `-10^9 <= target <= 10^9`
""",
    function_name="two_sum",
    function_signature={
        "params": [
            {"name": "nums", "type": "list[int]"},
            {"name": "target", "type": "int"},
        ],
        "returns": "list[int]",
    },
    examples=[
        {
            "input": "nums = [2, 7, 11, 15], target = 9",
            "output": "[0, 1]",
            "explanation": "nums[0] + nums[1] == 9, so we return [0, 1].",
        },
        {
            "input": "nums = [3, 2, 4], target = 6",
            "output": "[1, 2]",
            "explanation": "nums[1] + nums[2] == 6.",
        },
        {
            "input": "nums = [3, 3], target = 6",
            "output": "[0, 1]",
            "explanation": "Duplicates are allowed at different indices.",
        },
    ],
    hints=[
        "A brute-force loop over every pair is O(n²) — fine for the constraints, but you can do better.",
        "If you've already seen `target - nums[i]` earlier in the array, you've found your pair.",
        "Use a hash map mapping value → index. One pass, O(n).",
    ],
    starter_code={
        "python": "def two_sum(nums, target):\n    # Return the indices of the two numbers that add up to target.\n    pass\n"
    },
    reference_solution={
        "python": (
            "def two_sum(nums, target):\n"
            "    seen = {}\n"
            "    for i, x in enumerate(nums):\n"
            "        if target - x in seen:\n"
            "            return [seen[target - x], i]\n"
            "        seen[x] = i\n"
            "    return []\n"
        )
    },
    visible_test_cases=[
        {"input": [[2, 7, 11, 15], 9], "expected": [0, 1]},
        {"input": [[3, 2, 4], 6], "expected": [1, 2]},
        {"input": [[3, 3], 6], "expected": [0, 1]},
    ],
    hidden_test_cases=[
        {"input": [[1, 5, 8, 12], 13], "expected": [1, 2]},
        {"input": [[-3, 4, 3, 90], 0], "expected": [0, 2]},
        {"input": [[0, 4, 3, 0], 0], "expected": [0, 3]},
        {"input": [[-1, -2, -3, -4, -5], -8], "expected": [2, 4]},
        {"input": [[1, 2], 3], "expected": [0, 1]},
    ],
    comparator="sorted",
    topic_tags=["Arrays", "Hashing"],
    skill_node_names=["Arrays", "Hashing"],
    leetcode_url="https://leetcode.com/problems/two-sum/",
)


# ────────────────────────────────────────────────────────────────
# Problem 2 — Valid Palindrome
# ────────────────────────────────────────────────────────────────
VALID_PALINDROME = SeedProblem(
    slug="valid-palindrome",
    title="Valid Palindrome",
    difficulty=CodingDifficulty.EASY,
    description="""A phrase is a **palindrome** if, after converting all uppercase
letters to lowercase and removing all non-alphanumeric characters, it reads the
same forward and backward.

Given a string `s`, return `True` if it is a palindrome, or `False` otherwise.

**Constraints**
- `1 <= len(s) <= 2 * 10^5`
- `s` consists only of printable ASCII characters.
""",
    function_name="is_palindrome",
    function_signature={
        "params": [{"name": "s", "type": "str"}],
        "returns": "bool",
    },
    examples=[
        {
            "input": 's = "A man, a plan, a canal: Panama"',
            "output": "True",
            "explanation": '"amanaplanacanalpanama" reads the same forward and backward.',
        },
        {
            "input": 's = "race a car"',
            "output": "False",
            "explanation": '"raceacar" is not a palindrome.',
        },
        {
            "input": 's = " "',
            "output": "True",
            "explanation": 'Empty string after cleaning. Reads the same in both directions trivially.',
        },
    ],
    hints=[
        "Filter `s` down to lowercased alphanumeric characters first.",
        "Two pointers — one at each end, walk inward and compare.",
        "Python `str.isalnum()` and `str.lower()` make the cleaning step one-liner.",
    ],
    starter_code={
        "python": "def is_palindrome(s):\n    # Return True iff s is a palindrome (alphanumeric, case-insensitive).\n    pass\n"
    },
    reference_solution={
        "python": (
            "def is_palindrome(s):\n"
            "    filtered = [c.lower() for c in s if c.isalnum()]\n"
            "    return filtered == filtered[::-1]\n"
        )
    },
    visible_test_cases=[
        {"input": ["A man, a plan, a canal: Panama"], "expected": True},
        {"input": ["race a car"], "expected": False},
        {"input": [" "], "expected": True},
    ],
    hidden_test_cases=[
        {"input": ["0P"], "expected": False},
        {"input": ["aa"], "expected": True},
        {"input": ["a."], "expected": True},
        {"input": ["No 'x' in Nixon"], "expected": True},
        {"input": ["Was it a car or a cat I saw?"], "expected": True},
    ],
    comparator="exact",
    topic_tags=["Strings", "Two Pointers"],
    skill_node_names=["Strings"],
    leetcode_url="https://leetcode.com/problems/valid-palindrome/",
)


# ────────────────────────────────────────────────────────────────
# Problem 3 — Valid Parentheses
# ────────────────────────────────────────────────────────────────
VALID_PARENTHESES = SeedProblem(
    slug="valid-parentheses",
    title="Valid Parentheses",
    difficulty=CodingDifficulty.EASY,
    description="""Given a string `s` containing just the characters
`'('`, `')'`, `'{'`, `'}'`, `'['` and `']'`, determine if the input string is
valid. A string is valid if:

1. Open brackets are closed by the **same type** of brackets.
2. Open brackets are closed in the **correct order**.
3. Every close bracket has a corresponding open bracket of the same type.

**Constraints**
- `1 <= len(s) <= 10^4`
- `s` consists only of the six bracket characters above.
""",
    function_name="is_valid",
    function_signature={
        "params": [{"name": "s", "type": "str"}],
        "returns": "bool",
    },
    examples=[
        {"input": 's = "()"', "output": "True", "explanation": "One matched pair."},
        {"input": 's = "()[]{}"', "output": "True", "explanation": "Three matched pairs in sequence."},
        {"input": 's = "(]"', "output": "False", "explanation": "Wrong closing type."},
        {"input": 's = "([)]"', "output": "False", "explanation": "Wrong nesting order."},
    ],
    hints=[
        "Which data structure makes 'last opened should be first to close' easy?",
        "Push each opening bracket onto a stack. When you see a closer, pop and verify it matches.",
        "If the stack isn't empty at the end, there are unclosed brackets.",
    ],
    starter_code={
        "python": "def is_valid(s):\n    # Return True iff the brackets in s are balanced.\n    pass\n"
    },
    reference_solution={
        "python": (
            "def is_valid(s):\n"
            "    pairs = {')': '(', ']': '[', '}': '{'}\n"
            "    stack = []\n"
            "    for c in s:\n"
            "        if c in pairs:\n"
            "            if not stack or stack.pop() != pairs[c]:\n"
            "                return False\n"
            "        else:\n"
            "            stack.append(c)\n"
            "    return not stack\n"
        )
    },
    visible_test_cases=[
        {"input": ["()"], "expected": True},
        {"input": ["()[]{}"], "expected": True},
        {"input": ["(]"], "expected": False},
    ],
    hidden_test_cases=[
        {"input": ["([)]"], "expected": False},
        {"input": ["{[]}"], "expected": True},
        {"input": ["("], "expected": False},
        {"input": ["]"], "expected": False},
        {"input": ["((()))"], "expected": True},
    ],
    comparator="exact",
    topic_tags=["Stacks", "Strings"],
    skill_node_names=["Stacks & Queues"],
    leetcode_url="https://leetcode.com/problems/valid-parentheses/",
)


# ────────────────────────────────────────────────────────────────
# Problem 4 — Maximum Subarray (Kadane's)
# ────────────────────────────────────────────────────────────────
MAXIMUM_SUBARRAY = SeedProblem(
    slug="maximum-subarray",
    title="Maximum Subarray",
    difficulty=CodingDifficulty.MEDIUM,
    description="""Given an integer array `nums`, find the **contiguous subarray**
(containing at least one number) which has the **largest sum**, and return its sum.

**Constraints**
- `1 <= len(nums) <= 10^5`
- `-10^4 <= nums[i] <= 10^4`

**Follow-up:** Can you solve it in `O(n)` time?
""",
    function_name="max_subarray",
    function_signature={
        "params": [{"name": "nums", "type": "list[int]"}],
        "returns": "int",
    },
    examples=[
        {
            "input": "nums = [-2, 1, -3, 4, -1, 2, 1, -5, 4]",
            "output": "6",
            "explanation": "Subarray [4, -1, 2, 1] has the largest sum: 6.",
        },
        {
            "input": "nums = [1]",
            "output": "1",
            "explanation": "Trivial single-element array.",
        },
        {
            "input": "nums = [5, 4, -1, 7, 8]",
            "output": "23",
            "explanation": "The whole array sums to 23 — even with the -1, it's worth keeping.",
        },
    ],
    hints=[
        "Brute force is O(n²) by trying every (i, j) start/end pair. Can you avoid recomputing?",
        "At each position, you have two choices: extend the running subarray, or start fresh from here.",
        "Take the max of those two options. That's Kadane's algorithm — O(n).",
    ],
    starter_code={
        "python": "def max_subarray(nums):\n    # Return the maximum sum of any contiguous subarray.\n    pass\n"
    },
    reference_solution={
        "python": (
            "def max_subarray(nums):\n"
            "    best = current = nums[0]\n"
            "    for x in nums[1:]:\n"
            "        current = max(x, current + x)\n"
            "        best = max(best, current)\n"
            "    return best\n"
        )
    },
    visible_test_cases=[
        {"input": [[-2, 1, -3, 4, -1, 2, 1, -5, 4]], "expected": 6},
        {"input": [[1]], "expected": 1},
        {"input": [[5, 4, -1, 7, 8]], "expected": 23},
    ],
    hidden_test_cases=[
        {"input": [[-1]], "expected": -1},
        {"input": [[-2, -1, -3]], "expected": -1},
        {"input": [[8, -19, 5, -4, 20]], "expected": 21},
        {"input": [[1, 2, 3, 4, 5]], "expected": 15},
        {"input": [[-2, -3, 4, -1, -2, 1, 5, -3]], "expected": 7},
    ],
    comparator="exact",
    topic_tags=["Arrays", "Dynamic Programming"],
    skill_node_names=["Arrays", "Dynamic Programming"],
    leetcode_url="https://leetcode.com/problems/maximum-subarray/",
)


# ────────────────────────────────────────────────────────────────
# Problem 5 — Container With Most Water (two pointers)
# ────────────────────────────────────────────────────────────────
CONTAINER_WITH_MOST_WATER = SeedProblem(
    slug="container-with-most-water",
    title="Container With Most Water",
    difficulty=CodingDifficulty.MEDIUM,
    description="""You are given an integer array `height` of length `n`. There
are `n` vertical lines drawn such that the two endpoints of the *i*-th line are
`(i, 0)` and `(i, height[i])`.

Find two lines that, together with the x-axis, form a container that holds the
**most water**. Return the maximum amount of water a container can store.

You may not slant the container.

**Constraints**
- `n == len(height)`
- `2 <= n <= 10^5`
- `0 <= height[i] <= 10^4`
""",
    function_name="max_area",
    function_signature={
        "params": [{"name": "height", "type": "list[int]"}],
        "returns": "int",
    },
    examples=[
        {
            "input": "height = [1,8,6,2,5,4,8,3,7]",
            "output": "49",
            "explanation": "The lines at indices 1 and 8 (heights 8 and 7) form a container of width 7 × min(8,7) = 49.",
        },
        {
            "input": "height = [1,1]",
            "output": "1",
            "explanation": "Width 1, min height 1.",
        },
    ],
    hints=[
        "Area between two lines i < j is `min(height[i], height[j]) * (j - i)`. Brute force is O(n²).",
        "Start two pointers — left at index 0, right at index n-1. Track the max area seen so far.",
        "Move the pointer at the **shorter** line inward. (Moving the taller never helps — the height stays capped by the shorter side and the width only shrinks.)",
    ],
    starter_code={
        "python": "def max_area(height):\n    # Return the maximum water area between any two lines.\n    pass\n"
    },
    reference_solution={
        "python": (
            "def max_area(height):\n"
            "    left, right = 0, len(height) - 1\n"
            "    best = 0\n"
            "    while left < right:\n"
            "        h = min(height[left], height[right])\n"
            "        best = max(best, h * (right - left))\n"
            "        if height[left] < height[right]:\n"
            "            left += 1\n"
            "        else:\n"
            "            right -= 1\n"
            "    return best\n"
        )
    },
    visible_test_cases=[
        {"input": [[1, 8, 6, 2, 5, 4, 8, 3, 7]], "expected": 49},
        {"input": [[1, 1]], "expected": 1},
        {"input": [[4, 3, 2, 1, 4]], "expected": 16},
    ],
    hidden_test_cases=[
        {"input": [[1, 2, 1]], "expected": 2},
        {"input": [[2, 3, 4, 5, 18, 17, 6]], "expected": 17},
        {"input": [[1, 2, 4, 3]], "expected": 4},
        {"input": [[0, 2]], "expected": 0},
        {"input": [[1, 3, 2, 5, 25, 24, 5]], "expected": 24},
    ],
    comparator="exact",
    topic_tags=["Arrays", "Two Pointers"],
    skill_node_names=["Arrays"],
    leetcode_url="https://leetcode.com/problems/container-with-most-water/",
)


SEED_PROBLEMS: list[SeedProblem] = [
    TWO_SUM,
    VALID_PALINDROME,
    VALID_PARENTHESES,
    MAXIMUM_SUBARRAY,
    CONTAINER_WITH_MOST_WATER,
]


def seed_if_empty(db: Session) -> int:
    """If the `coding_problems` table is empty, insert all SEED_PROBLEMS.

    Returns the number of problems inserted. Idempotent: subsequent calls are
    no-ops once any rows exist.
    """
    existing = db.scalar(select(CodingProblem).limit(1))
    if existing is not None:
        return 0

    inserted = 0
    for seed in SEED_PROBLEMS:
        problem = CodingProblem(
            slug=seed.slug,
            title=seed.title,
            description=seed.description,
            difficulty=seed.difficulty,
            function_name=seed.function_name,
            function_signature=seed.function_signature,
            examples=seed.examples,
            hints=seed.hints,
            starter_code=seed.starter_code,
            reference_solution=seed.reference_solution,
            visible_test_cases=seed.visible_test_cases,
            hidden_test_cases=seed.hidden_test_cases,
            comparator=seed.comparator,
            topic_tags=seed.topic_tags,
            skill_node_names=seed.skill_node_names,
            leetcode_url=seed.leetcode_url,
        )
        db.add(problem)
        inserted += 1

    db.commit()
    logger.info("Seeded %d coding problems", inserted)
    return inserted
