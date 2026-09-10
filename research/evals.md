
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


