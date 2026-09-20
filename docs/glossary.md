# Glossary

The vocabulary used in this repository, in plain language. Every entry points at
something that has actually happened here, so you can go and look at the real
thing rather than trusting the definition.

This is a living document. If a word turns up that isn't here, it belongs here.

---

## Git — keeping track of changes

**Git** is the system that records every change ever made to the code. Not a
backup: a complete history, where you can ask "what did this file look like in
March" or "who changed this line, when, and why" and get an exact answer. It is
the reason nobody has to email `talent_suite_pricing_v137.html` around any more.

**Repository (repo)** — one project's worth of code plus its entire history.
Ours is `chrisdevelop3r/HelloCodeSchoolProject`. It lives in two places at once:
a copy on GitHub's servers, and a copy on whatever machine is working on it.
They are equals; neither is "the real one" until you decide it is.

**Commit** — one saved change, with a message explaining *why*. This is the
atom of the whole system. A good commit is one complete thought: "extract the
pricing engine", not "stuff I did on Tuesday". The message matters more than
people expect, because in two years the message is the only explanation anyone
will have. Each commit has an ID like `7a1d62e`.

**Branch** — a parallel line of work. You take a copy of the code, make commits
on it, and the main line is untouched the whole time. If the work turns out to
be wrong you throw the branch away and nothing was ever at risk. Ours is called
`claude/quote-builder-v2-architecture-wgxylu`.

**`master` / `main`** — the branch everyone agrees is the real one. Work happens
on branches; it becomes official when it reaches this one. (`master` is the
older name, `main` the newer. Ours says `master`.)

**Merge** — taking the commits from one branch and folding them into another.
Usually a branch into `master`. This is the moment work becomes official.

**Merge conflict** — two branches changed the same lines in different ways, and
Git refuses to guess which is right. It stops and asks a human. Annoying, but
the alternative — silently picking one — is much worse.

**Push** — send your commits from your machine up to GitHub, so they exist
somewhere other than your laptop.

**Pull** — the opposite: fetch commits from GitHub down to your machine, so you
have what everyone else has done. (**Fetch** is the half-step: get the changes
but don't apply them yet.)

**Clone** — make your first local copy of a repository that already exists.

**Diff** — the difference between two versions: which lines were added, removed
or changed. When someone says "read the diff", they mean look at what actually
changed, not the whole file.

**Staging / `git add`** — choosing which changes go into the next commit. Lets
you commit two unrelated fixes separately instead of as one lump.

---

## GitHub — working with other people

**GitHub** — where the repository lives so more than one person can work on it,
plus the tools built around that: reviews, discussions, automation.

**Pull request (PR)** — a proposal: "here are my commits, on my branch — please
look, and if you agree, merge them into `master`." The name is historical
("please pull my changes"); think of it as *a change request with a discussion
attached*. Ours is
[#1](https://github.com/chrisdevelop3r/HelloCodeSchoolProject/pull/1). A PR is
where review, automated checks and the decision to merge all happen. Nothing
reaches `master` except through one.

**Review** — someone reads the diff and either approves it, asks for changes,
or comments. On a PR you can comment on one specific line, which is how you say
"this rounding looks wrong" and have it land next to the rounding.

**Issue** — a recorded piece of work or a bug. A PR changes code; an issue just
describes something. "The deal room shows TBC as the signatory" is an issue.

**Head / base** — a PR has a **base** (where it's going: `master`) and a **head**
(where the changes are: our branch). "The current head" means the latest commit
on the branch, i.e. what you'd actually be merging right now.

---

## CI and testing — the machine that checks the work

**CI — continuous integration.** A robot that, every time a change is proposed,
takes a clean computer, sets up the project from scratch, and runs every check.
The point is that it doesn't trust anybody's laptop. "It works on my machine" is
not evidence; CI passing is. Ours is defined in `.github/workflows/ci.yml`.

Why it matters more here than in most projects: this code computes prices. A
mistake doesn't crash, it just quotes the wrong number, and nobody notices until
an invoice disagrees with a contract.

**CI run / job / check** — one execution of that robot. A **green** check passed,
a **red** one failed. "Red CI" means something is broken and the PR isn't ready.

**GitHub Actions** — GitHub's specific brand of CI, which is what we're using.

**Workflow** — the recipe CI follows: install, set up Chromium, check the
fixtures, typecheck, run the tests, run the mutation check.

**Test** — code that runs the real code and asserts what the answer should be.
We have 108. They run in under a second, which is what makes them worth having:
a check nobody waits for is a check nobody runs.

**Test suite** — all the tests together.

**Golden fixture / golden test** — our main safety net, and the most important
idea in this repository. We ran 73 scenarios through the *original prototype*
and wrote down exactly what it answered. Those recorded answers are the
"fixtures". The new engine is then required to produce byte-for-byte identical
answers. It means the rewrite can be checked against the thing it replaces,
rather than against somebody's memory of what it used to do.

The critical rule: **a fixture is v137's answer, not ours.** Editing one to make
a test pass turns the safety net into a decoration that still looks like a
safety net. CI regenerates them from the prototype and fails on any difference,
so that isn't possible by accident.

**Regression** — something that used to work and now doesn't. What the tests
are there to catch.

**Coverage** — what percentage of the code the tests actually execute. Ours is
100% of statements and 95% of branches on the engine. Useful but limited:
coverage tells you the code *ran*, not that anyone checked the answer.

**Coverage gate / threshold** — a minimum coverage the build requires. Ours is
set just below what we actually achieve. The discipline is that it only ever
goes up. Lowering a gate to make a red build green is how a project ends up with
a suite that guarantees nothing.

**Mutation testing** — the answer to "how do I know the tests are any good?" You
deliberately break the code in specific ways and check that the tests notice. If
you break the rounding and every test still passes, you've learned the tests
were never checking the rounding. We do ten of these (`pnpm mutants`); one
survived on the first attempt, which is exactly the kind of blind spot the
technique exists to find.

**Flake / flaky test** — a test that passes and fails at random. Poisonous,
because it trains people to ignore red builds. "It's just flaky" is a claim that
needs evidence, not a default explanation.

---

## The stack — what this is built out of

**TypeScript** — JavaScript with types. You declare that a price is a number and
a currency is one of four specific strings, and the compiler catches it when the
code contradicts itself, *before* anything runs.

**Typecheck** — running that compiler purely to find contradictions. No output,
just an answer to "is this code internally consistent?"

**Node.js** — lets JavaScript run on a server instead of only in a browser.

**Package** — a reusable unit of code with a name and a version.
`@assessio/pricing` is ours.

**Monorepo** — several packages living in one repository, sharing one history
and one set of checks. The alternative is a repo per package, which means a
change spanning two of them can't be reviewed or tested as one thing.

**pnpm** — the tool that installs the packages we depend on and understands the
monorepo layout. (`npm` and `yarn` are the alternatives.)

**Lockfile** (`pnpm-lock.yaml`) — records the *exact* version of every dependency,
so CI installs precisely what was tested and not a slightly newer release that
came out yesterday.

**Dependency** — someone else's package that ours needs.

**Playwright** — drives a real browser under automation. We use it to run the
original prototype and capture its answers.

**Chromium** — the open-source browser Playwright drives.

**Vitest** — the tool that runs our tests.

---

## Ideas that keep coming up

**Pure function** — a function whose answer depends only on what you hand it. No
reading the clock, no reading the database, no hidden state. Hand it the same
inputs, get the same answer, forever. The pricing engine is pure, and that is
why it can be tested exhaustively and why the same code can run in the browser
for instant feedback and on the server for the number that actually counts.

**Server-authoritative** — the server decides, not the browser. The browser can
compute a price to show it instantly, but the price that gets saved is the one
the server calculated. Otherwise anyone who can open developer tools can quote
themselves any number they like.

**Immutable** — cannot be changed after it is created. An issued quote must be
immutable: a quote sent in March has to re-render identically in November, after
the price book has changed three times.

**Source of truth** — the one place a fact officially lives. When the same rule
is implemented twice, the two copies drift, and the bug is always in the copy
you forgot about.

**Port** — moving code to a new language or platform while deliberately keeping
its behaviour identical. What we did to the pricing engine. A port is explicitly
*not* an improvement: mixing the two means that when the answer changes you
can't tell whether it's the move or the improvement that did it.

**Refactor** — restructuring code without changing what it does. Safe only when
you have tests that would notice if you were wrong.

**Technical debt** — a shortcut that makes today easier and every later day
harder. Sometimes worth taking, always worth writing down.

**Regenerate, don't edit** — some files are produced by a tool from a source of
truth. The fixtures, the captured price book, the lockfile. Editing them by hand
appears to work and then quietly disagrees with the tool forever.
