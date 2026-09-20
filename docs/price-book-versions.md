# Versioned price books

> A quote sent in March must re-render identically in November, after the price
> book has changed three times.
> — `docs/quote-builder-architecture.md`, rule 2

That is the whole requirement. It is only possible if a quote can name the exact
prices it was made from, which means the price book stops being a file and
becomes a series of versions with effective dates.

## The model

A **version** is a price book plus the window it applies to:

```ts
createVersion(
  {
    id: 'v137',
    label: 'Talent Suite v137',
    status: 'published',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,          // exclusive, so windows can abut exactly
    publishedAt: '2025-12-20',
  },
  book,
);
```

**Statuses.** `draft` is being prepared; `published` is in force; `archived` has
been withdrawn. You may only quote from a published book — but you can always
*re-render* from an archived one, which is what makes withdrawing a price list
safe.

**A version is frozen**, drafts included. Deeply, so no nested rate can move,
and it carries a fingerprint of its contents. A draft is revised by building a
new version from a new book, never by editing one in place: a book that can
still move would carry a fingerprint that has stopped describing it.

**Published windows may not overlap.** Two books both claiming to be in force on
the same day is not an ambiguity to resolve at read time — it is a data error,
and `PriceBookRegistry` refuses it when it is built rather than letting a rep
discover it as a wrong price. Drafts and archived versions are exempt, which is
what lets a replacement be prepared while the current book is still selling.

## Validation

`createVersion` validates the book first, so a book that cannot price correctly
never becomes a version anyone can quote from.

The engine itself stays permissive on purpose — it is a pure function and it
will price whatever it is handed, filling in defaults for anything absent
(`test/defensive.test.ts` pins down exactly what it does). That is the right
behaviour for the engine and the wrong behaviour for the front door, because a
book missing a rate prices silently rather than loudly. So validation guards the
door and the engine stays simple.

Every rule is one that would otherwise produce a wrong number rather than an
error:

| Refused | Because |
|---|---|
| a pack with no `bands`, `bandModel` or `suiteOf` | it prices at zero and says nothing |
| a band that is both a flat fee and a rate, or neither | the ladder charges the wrong one |
| `phBands.bands` that do not strictly increase | the bracket rates divide by the gap between bands |
| a `threshold` fee with no `priceHigh` | crossing the threshold charges `undefined` |
| a suite naming a pack the book does not have | the engine skips it, so the suite quietly costs less |
| a fee needing a module the book does not have | it can never be sold |
| two packs or two modules sharing an id | the wrong one is found |
| `fx.EUR` missing or not exactly `1` | every amount is already in euros, so anything else re-denominates |
| `fx.SEK` missing or zero | the predictive-hiring ladder is listed in SEK and divided by it |

**Validation hands back the object it was given, never Zod's rebuilt copy.**
The fingerprint is taken over the book, so returning a copy — with unknown
fields stripped — would silently change what a quote was priced from. Validation
answers a question; it does not get to edit the answer. There is a mutation test
for exactly that.

## Issuing and re-rendering

```ts
const registry = new PriceBookRegistry([v137, v138]);

const issued = issueQuote(registry, {
  quoteId: 'Q-1043',
  issuedAt: '2026-03-15',
  input,                 // no price-book id: the one in force that day is used
});

// …three price books later…
rerenderQuote(registry, issued);   // identical numbers, or it throws
```

An issued quote stores its inputs, the price book version id, that book's
fingerprint, and the computed result.

`rerenderQuote` does **not** read the stored numbers back. It recomputes from
the stored inputs against the stored book and compares. That distinction is the
point: returning the stored total would always agree with itself and would prove
nothing.

It refuses, separately and by name, on the two ways this goes wrong:

- **the book moved** — someone edited a published price book, so the quote's own
  prices are no longer recoverable from it;
- **the engine moved** — the book is intact but the code now answers
  differently, which means a pricing change shipped without anyone deciding it
  should apply to quotes already in customers' hands.

Neither is a case for returning the stored number and carrying on. The error
names every field that moved, so a failure points at the line rather than at the
quote.

## What the fingerprint is and is not

It is FNV-1a over a canonicalised JSON rendering of the book, so reformatting a
file or reordering two fields cannot change it.

It is **drift detection, not tamper protection.** There is no secret in it, so
anyone who can edit a book can edit the recorded fingerprint too. It catches the
thing that actually happens — someone edits a published book and last quarter's
quotes quietly start re-rendering at this quarter's prices — and does not
pretend to catch an attacker. Signing belongs server-side, where there is a key.

It is pure TypeScript rather than `node:crypto` because the engine runs in the
browser as well as on the server.

## Open questions

- **When did v137 take effect?** Nothing here invents an `effectiveFrom` for a
  real price list. A registry is built by its caller, and the dates are a
  commercial fact, not a default.
- **FX rates live inside the book** (`fx.SEK.rate`), and they are not only for
  display: the predictive-hiring ladder is priced in SEK and converted, so the
  SEK rate changes the euro price. Freezing FX with the book is therefore
  correct, but it means every rate change needs a new price book version. If
  that proves too heavy operationally, the alternative is to lock FX per quote
  instead — which changes what a version means, so it is a decision to take
  deliberately rather than discover.
