
- simlulate conversation up to a point 

```
test_case = ConversationalTestCase(
    turns=[
        Turn(role="user", content="I want a refund for order #1234."),
        Turn(role="assistant", content="I'd be happy to help with that. Let me look up order #1234."),
        Turn(role="user", content="It's been defective since day one."),
        Turn(role="assistant", content="I'm sorry to hear that. I've processed a full refund to your original payment method."),
    ]
)
```

- Assert on structure, not content

LLM responses vary between runs. Instead of asserting on exact output strings, verify the structural properties of the response: message types, tool call names, argument shapes, and message count.

- Ideally we would write some lisptc checks `(called list-toolkit) -> t` that we run in the end of the 
turn, each check should have 3 states: true, false, pending, if turns finish and the check is still pending its considered false

- syntaxe errors, prose Errors should be checked as well

- large number of turns is also a failure mode

- eval suite:
    check if somthing happend, before, after

```
(defcheck finds-the-server
  (before (called-any "search-mcps" "list-toolkit") (called "load-mcp")))

(defcheck waits-for-the-load
  (before (awaited (called "load-mcp" "playwright")) (called-server "playwright")))

(defcheck opens-the-site
  (eventually (called "playwright/browser_navigate" :url (contains "hyko.ai"))))

(defcheck stays-in-scope
  (never (called-server-other-than "playwright")))

(defcheck stops
  (within 10 (halted)))
```

Combinators: eventually · never · always · before · after · within · once. 
That's the scaling answer — new evals are s-expressions, not code.

we can add also judge

we should base it over the current test suite which vitest, just add the ability to make actual tool calls to online llms, these evals have to carry on a special `.eval.ts` extension


since what the agent said is also prose that we can use in order to call llm judge on it, or even run 
actual conditions on it (the agent never mentioned the word `lisp`) for example 
