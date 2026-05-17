# Type Signature Laws

A language-agnostic discipline for designing systems that are legible to both compilers and AI assistants. These principles derive from functional programming but apply equally to Python, TypeScript, Go, Rust, Java, or any language with a type system (or conventions that simulate one).

The core claim: the type signature is the contract. When signatures are precise, implementations follow mechanically, bugs surface at design time, and AI-generated code converges on correctness. When signatures are loose, every function becomes a puzzle that requires reading the implementation to understand, and AI assistants fill the ambiguity with plausible-looking wrongness.

## The Fifteen Laws

### 1. Make illegal states unrepresentable

Design types so that invalid combinations cannot be constructed. If a record has a status and an approver, do not allow "approved with no approver" to exist as a value. Use sum types, discriminated unions, sealed classes, or whatever your language offers to express "this is one of these specific shapes" rather than "this is a bag of optional fields."

A `RawIntake` and a `SanitizedIntake` should be different types. The function that sends data to an external service should accept only the sanitized type. The compiler then enforces the boundary that would otherwise rely on memory and code review.

### 2. Push side effects to the edges

The core of the system should be pure functions: data in, data out, no I/O, no mutation, no hidden state. Effects (network, disk, database, time, randomness, logging) live at the outermost layer. This is sometimes called "functional core, imperative shell."

Pure functions are the ideal unit of AI collaboration. The signature fully specifies the contract, the implementation is short, and no external context is needed to verify correctness. When you paste a pure function into an assistant with its signature, the result is usable. When the function secretly writes to a database, the assistant cannot see that and cannot help.

### 3. Separate description from execution

Model what you want to do as data, then have a separate interpreter run it. A pipeline step is a value describing a step, not the step itself executing. You build up a program as a data structure, review it, test it, and only then hand it to a runner.

This separation is what makes workflow orchestration tools valuable at the infrastructure level, and the same discipline pays off inside individual functions.

### 4. Encode errors in return types, not exceptions

A function that can fail should say so in its signature. Return a result type (`Either`, `Result`, `Option`, tagged union, or whatever your language provides) rather than throwing. Every caller is then forced by the type system to acknowledge the failure mode.

Exceptions are invisible to signatures and invisible to AI assistants reading the code. A function that looks total but throws creates caller code that silently breaks in production. A function whose signature advertises its failure modes produces caller code that handles them.

### 5. Prefer total functions over partial ones

A total function returns a valid value for every input in its domain. A partial function crashes or misbehaves on some inputs. `head(list)` is partial; `head_or_none(list)` is total. Total functions compose cleanly and create no landmines. Partial functions create hazards that propagate silently through the call graph.

When a function must reject some inputs, move the rejection into the type: accept a `NonEmptyList` instead of a `List`, accept a `ValidatedEmail` instead of a `String`. The caller does the proving, and the function becomes total over its narrower domain.

### 6. Design with algebras, not objects

Define the operations and their laws first, implementations later. An algebra is a set of operations plus the rules they must obey. A pipeline step might require `run`, `compensate`, and `verify`, with the law that `verify` after `run` succeeds, and `compensate` after `run` restores the prior state.

Once the algebra is specified, any implementation has a clear target and any AI-generated implementation has an explicit correctness criterion. The laws are the tests.

### 7. Parse, don't validate

A validator returns a boolean and leaves you holding the original untrusted type. A parser returns a new type that carries structural proof the data is valid. `validate_email(s: String) -> bool` is weak; `parse_email(s: String) -> Result[Email, ParseError]` is strong. Once you hold an `Email`, you never re-check it. The type is the proof.

This is the pattern for every boundary in the system: input arrives as unstructured data, gets parsed into a domain type at the edge, and flows through the interior as that domain type. Re-validation disappears. The compiler carries the invariant.

### 8. Make functions small and composable

Many tiny functions, each doing one transformation, composed by function application or explicit combinators. Small pure functions are the ideal unit of human review, AI collaboration, and mechanical testing. The signature describes the intent, the body is short enough to verify by eye, and composition handles the complexity.

A function that does not fit on a screen is almost always hiding multiple responsibilities that should be separate functions with separate signatures.

### 9. Immutability by default

Never mutate, always transform. Return new values rather than updating existing ones. Use `const`, `val`, `final`, frozen dataclasses, or whatever your language offers. Reserve mutation for performance-critical hot paths where profiling has proven it necessary.

AI assistants reason about immutable code far more reliably because they do not have to track what has changed where. Mutation is where AI-generated code tends to fail subtly, because the model cannot see the full call graph of every reference holder.

### 10. Referential transparency as the acceptance test

An expression is referentially transparent if you can replace it with its value without changing the program's meaning. If `fetch_user(id)` is referentially transparent, calling it twice is the same as calling it once and reusing the value.

This is the single most useful property for AI-assisted refactoring. When an assistant suggests a change, the test is: does this preserve referential transparency? If yes, the change is safe in isolation. If no, the full effect graph must be understood before the change can be accepted.

### 11. Laws over tests

Unit tests check specific examples. Laws assert properties that must hold for all inputs. "Reversing twice yields the original list" is a law; "reversing [1, 2, 3] yields [3, 2, 1]" is an example. Property-based tests generate examples and check the law against each one, catching bugs that example tests miss.

Laws are also better prompts for AI assistants. Asking for property tests produces stronger coverage than asking for unit tests because the properties force the assistant to reason about the full input space rather than a handful of cases.

### 12. Types document intent better than comments

A comment saying "this list is never empty" rots the moment someone passes an empty list. A `NonEmptyList` type is enforced by the compiler forever. Comments may be stale, variable names may lie, but the signature is what the compiler checked.

When handing code to an AI assistant, the types are the part of the context that can be trusted. Every other signal is heuristic; the types are verified.

### 13. Isolate non-determinism

Time, randomness, external state, and environment access are non-deterministic and should be passed in as parameters, not reached for inside the function. `generate_id(now: Instant, rand: RandomSource) -> Id` is testable and reproducible; `generate_id()` that calls the system clock internally is neither.

This is determinism-before-generation applied one level deeper: make every non-deterministic dependency explicit in the signature, and the function becomes a pure function of its inputs.

### 14. Effects are values

An effectful computation can be represented as a value that describes what will happen when run, rather than something that happens immediately. This lets you pass effects around, combine them, retry them, log them, and inspect them without executing them.

At the infrastructure level, workflow orchestrators embody this idea: a state machine definition is a value, and the runner executes it. The same pattern inside application code lets you show an AI assistant the whole workflow as data without needing a running environment for it to reason about.

### 15. The principle of least power

Use the least powerful abstraction that solves the problem. If a transformation can be expressed with a simple map, do not reach for a monad. If a function does not need to fail, do not give it a failure type. If a value does not need to be optional, do not wrap it in an option.

Less power means stronger guarantees. A function that could do anything tells the reader (human or AI) nothing. A function whose signature constrains it to one kind of transformation tells the reader exactly what to expect.

## How to Apply These Laws

Before writing or accepting AI-generated code, check the signatures first:

- Does every function's signature fully describe its contract, including failure modes and effects?
- Are there illegal states that the types currently allow? Can they be refactored away?
- Are effects isolated to the edges, or are they scattered through the core?
- Is non-determinism explicit in parameters, or hidden inside function bodies?
- Can every function's correctness be verified from its signature and body alone, without external context?

When prompting an AI assistant, lead with the types. Give it the signature, the domain types, and the laws the function must satisfy. The implementation then falls out of the specification rather than being improvised from a natural-language description.

When reviewing AI-generated code, check the signature before the implementation. If the signature is imprecise, the implementation is guessing. If the signature is precise and the implementation type-checks, the remaining question is whether the laws hold, which is a much narrower review.

## The Meta-Principle

Functional programming and effective AI assistance converge on the same discipline: make the types do the talking, keep functions pure, encode invariants structurally, and treat the signature as the contract. The code is almost incidental once the shape is right.

A system designed this way is legible to compilers, to collaborators, to AI assistants, and to your future self. A system designed without this discipline is legible only to whoever wrote it, and only while the context is still fresh in their memory.

Build for the first kind.
