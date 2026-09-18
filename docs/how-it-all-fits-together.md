# How it all fits together — a plain-language overview

Companion to `quote-builder-architecture.md`. That document is the plan; this one explains
the vocabulary and the shape of the system for someone who has not built a web app before.

---

## 1. The one idea everything hangs off: two computers

Every web application is a conversation between **two computers**.

**The browser** (Chrome on a salesperson's laptop). It draws things on screen and reacts to
clicks. It is fast and it is *theirs* — they can open devtools and change any number on the
page. Nothing it holds is trusted and nothing it holds survives a refresh.

**The server** (a computer in a data centre that is always on). Nobody can open devtools on it.
It holds the real data, decides what is true, and remembers things after everyone goes home.

Code that runs in the browser is the **frontend**. Code that runs on the server is the
**backend**. That is the entire distinction. Not two technologies — two *locations*.

## 2. Where your prototype sits today

```
   Salesperson's laptop
   ┌──────────────────────────────────┐
   │  Chrome                          │
   │  ┌────────────────────────────┐  │
   │  │ talent_suite_pricing_v137  │  │      (no server anywhere)
   │  │  · the screen              │  │
   │  │  · the pricing maths       │  │
   │  │  · the price book          │  │
   │  │  · the quote being built   │  │
   │  └────────────────────────────┘  │
   └──────────────────────────────────┘
```

Everything is in one file on one laptop. This explains every limitation at once:

- **Nothing saves** — close the tab, the quote is gone. There is nowhere to save *to*.
- **Nothing is shared** — your colleague's copy is a different file with different numbers.
- **No logins** — there is no server to check a password against.
- **Nothing is authoritative** — the price book is JavaScript in the page; anyone can edit it.
- **Versioning by filename** — `v137` is what a team does when there is no server.

It is a very good prototype. It is not a system, and no amount of work on that file makes it one.

## 3. Where you are going

```
  Salesperson's browser              The internet          Your server(s)
  ┌──────────────────────┐                                 ┌──────────────────────────┐
  │ FRONTEND             │                                 │ BACKEND                  │
  │  · draws the screen  │ ──── "quote 600 employees,  ──> │  · checks who is asking  │
  │  · reacts to clicks  │        Perf Pro, 3 years"       │  · computes the price    │
  │  · shows the total   │                                 │  · saves the quote       │
  │                      │ <──  "€X/yr, quote id 4182" ─── │  · makes the PDF         │
  └──────────────────────┘                                 └────────────┬─────────────┘
                                                                        │
                                                           ┌────────────▼─────────────┐
                                                           │ DATABASE                 │
                                                           │  quotes · price book     │
                                                           │  users · audit log       │
                                                           └──────────────────────────┘
```

Three pieces. The frontend is a face, the backend is a brain, the database is a memory.

## 4. One quote, all the way through

Anna in sales opens `quotes.assessio.com`.

1. **Browser asks the server for the page.** The server sends back HTML, CSS and JavaScript —
   the frontend. Anna's browser runs it and draws the builder.
2. **The frontend asks: "what is the current price book?"** The backend reads it from the
   database and sends it back as data.
3. **Anna types 600 employees and picks Performance Pro.** The frontend does the maths
   *locally* so the number updates instantly as she types. This copy is a convenience — not
   the truth.
4. **Anna clicks "Create quote".** The frontend sends her choices to the backend.
5. **The backend does the maths again**, from the same shared code, and this time it counts.
   It checks Anna is allowed to give a 12% discount. It writes to the database: the inputs,
   the price-book version, the FX rate on the day, the computed lines. Gets back `id 4182`.
6. **The backend renders a PDF** and stores it.
7. **Anna sends a link.** The customer opens `quotes.assessio.com/q/4182-a7f3`. The backend
   loads quote 4182 and shows it — in November, on a phone, after the price book has changed
   three times, identical to the day it was sent.

Step 5 is why the backend exists. Steps 3 and 5 run *the same code in two places* — which is
why §1 of the architecture doc insists the pricing engine be extracted as a standalone,
importable library with no browser code in it.

## 5. Languages

**TypeScript, both sides.** One language for the frontend and the backend.

TypeScript is JavaScript with type labels — you already wrote the JavaScript, so this is not a
new language so much as a stricter version of the one in your file:

```js
// JavaScript today — nothing catches the mistake
function bandTotal(bands, qty, segMult) { ... }
bandTotal(bands, "600", 1)          // a text "600", not the number 600. Silent wrong answer.
```
```ts
// TypeScript — the editor underlines it in red before you ever run it
function bandTotal(bands: Band[], qty: number, segMult: number): number { ... }
bandTotal(bands, "600", 1)          // ✗ Argument of type 'string' is not assignable to 'number'
```

For a pricing system that is worth a great deal. Most bugs of the kind that quietly produce a
wrong total get caught as you type.

The reason to use it on **both** sides is specific to your project: the pricing engine has to
run in the browser (instant feedback) *and* on the server (authoritative). One language means
one implementation of that engine instead of two that drift apart. Two implementations of a
pricing rule is a guarantee of a quote that does not match its own invoice.

Python or Java or C# would all work for a backend. You would then need the pricing maths twice.
Don't.

The full set of names you will meet, and what each one is:

| Name | What it is |
|---|---|
| **TypeScript** | The language. JavaScript + types. |
| **React** | The library for building screens out of reusable components. |
| **Next.js** | The framework that packages React + the backend into one deployable app. |
| **Node.js** | The thing that runs JavaScript on a server instead of in a browser. |
| **PostgreSQL** | The database. |
| **Prisma** | Lets you read and write the database in TypeScript instead of raw SQL. |
| **Zod** | Checks incoming data is the right shape. "Is `users` really a number?" |
| **Vitest / Playwright** | Test runners. Vitest for the maths, Playwright for clicking the UI. |
| **Git / GitHub** | Version history. Replaces `v137`. |

Next.js is the reason you do not need a separate backend project on day one. The same app holds
both — screens in one folder, API endpoints in another — and deploys as one thing.

## 6. Hosting

"Hosting" is renting a computer that is always on, with a name on the internet.

You need three rented things:

**1. Somewhere to run the app** — **Vercel** is the natural fit for Next.js (same company builds
both; you connect GitHub and every push deploys). **Render**, **Railway** and **Fly.io** are
equivalents. Roughly $20–40/month at your scale.

**2. Somewhere to keep the database** — **Neon** or **Supabase** (managed PostgreSQL) or the
database your host offers. Free to about $25/month at your scale. Managed means someone else
runs the backups.

**3. A domain name** — `quotes.assessio.com`, which is free if IT points a subdomain of the
domain you already own.

**Total: roughly $50/month** for an internal tool with twenty salespeople. Hosting is not where
the money goes; the engineering time is.

Two things to settle at signup, because they are annoying to change later:

- **Pick an EU region** (Frankfurt or Stockholm). You are a Swedish HR company and this will
  eventually touch personal data. Choose it once, at the start.
- **Do not host it yourself.** An on-prem server means you own patching, backups, certificates
  and uptime. Managed hosting means you own the app. You want to own the app.

## 7. Environments

The same app runs in three places, so mistakes stay cheap:

- **Local** — on your laptop, `npm run dev`, its own throwaway database. Break whatever you like.
- **Preview** — an automatic temporary URL for every proposed change, so colleagues can click a
  feature before it is real. Vercel does this for free per branch.
- **Production** — `quotes.assessio.com`. Real quotes, real customers, backed up.

Changes move local → preview → production, and only after tests pass. That pipeline is called
**CI** (continuous integration): a robot that runs your tests on every change and refuses to
deploy a red build. It is also the gate the agent team closes its loop on — see §4 of the
architecture doc.

## 8. What day one actually looks like

The first genuinely useful thing to build is *not* the app. It is `packages/pricing`: the
maths lifted out of the HTML into tested TypeScript, with the fixtures from Phase 0 proving it
still produces v137's numbers.

No server, no database, no hosting, no account to sign up for. Just a folder of `.ts` files and
a test command that goes green. Everything in this document is then built *around* that library
— the browser imports it, the server imports it, and neither can disagree with the other.

## 9. What you do not need yet

Worth naming so nobody sells them to you early: Kubernetes, Docker, microservices, GraphQL,
Redis, a message queue, a separate backend service, a mobile app, multi-region anything.

These solve problems you will not have with twenty internal users. Adding them now buys
complexity and no capability.

SSO and HubSpot are different — they are genuinely coming, and the architecture makes room for
them (server-side auth, an integrations layer). They are just not *first*. Build the thing that
computes a price correctly and remembers it. Then log people into it. Then connect it to HubSpot.
