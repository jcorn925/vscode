# Positioning: GoalConsole vs. Other Dev Tools

*Working notes from a positioning discussion, 2026-07-25. Premise: the IDE is currently strongest at (1) creating new projects from scratch — GitHub scanning with proposal graphs — and (2) LLM action visibility — surface cards and steps lists.*

## The core insight: your two strengths are one strength

"Creating from scratch with proposal graphs" and "LLM action visibility" look like separate features, but they solve the same underlying problem: **trusting work you delegated**. The proposal graph makes the plan legible before code exists; surface cards, step lists, and evidence panels make the execution legible while it happens. That unification matters because positioning built on two unrelated pillars reads as a feature list; positioning built on one job reads as a category. The job is: *delegate the build without losing the plot.*

## Position against the failure modes of your neighbors, not their features

The competitive map has three occupied corners, and each has a well-known failure mode you're structurally positioned to exploit:

**Prompt-to-app builders (Lovable, Bolt, v0, Replit Agent).** They win on time-to-wow, and their failure mode is the opaque demo: one prompt, one blob of code, no architecture, and a cliff the moment you need a second surface or a real schema. You are genuinely different here — a goal decomposes into surfaces with schemas, events, and a monorepo layout; the plan is grounded in scanned reference repos rather than model priors; and there's a real VS Code underneath when you outgrow the guided experience. The message against this corner isn't "we're also fast" (you'll lose that demo war) — it's *"they generate a demo; we plan a product."*

**AI-native editors (Cursor, Windsurf, Copilot).** They win on edit velocity inside existing code. Don't fight there — it's their home turf and their distribution is enormous. Their failure mode is that they start at the file level: they have no opinion about what should exist. Your unit of work is the goal and the surface, not the buffer. The message: *"they make you faster once the code exists; we handle the part before it exists."* This also tells you what **not** to message: autocomplete quality, chat UX, model choice. Any sentence that would be true of Cursor is a wasted sentence.

**Autonomous agents (Devin, background agents, Codex-style).** They make the same delegation promise you do, and their failure mode is the black box — you find out what the agent did when it's done, wrong. This is where your second strength becomes the moat: task trees that persist and resume, step lists you can pause/retry/skip, process notes with evidence, graphs that diff proposal against reality. The message: *"autonomy you can audit."* I'd argue this is your most defensible contrast, because visibility is architectural in the product (it's threaded through everything — the rail, the panels, the persisted `.agent` state), whereas an agent vendor bolting on a log viewer doesn't get the same thing.

## The refinement to make

Forced to one sentence: **"The IDE where you can watch an idea become a product — planned from real codebases, built in steps you can see, verify, and steer."** Greenfield is the *wedge* (it's when people are willing to adopt a new tool, and it's where the product is strongest today); legibility is the *differentiator* (it's why they stay, and it's what neighbors can't cheaply copy).

Three tactical notes:

1. **Don't lead with "AI IDE."** That category is owned, and it invites a feature-by-feature comparison with Cursor that you lose on breadth. Lead with the outcome (goal → working product) and let "it's a full IDE underneath" be the trust-building reveal — the escape hatch that prompt-to-app tools can't offer.

2. **Make "planned from real codebases" a first-class claim.** The GitHub scanning → proposal graph flow is the most *novel* asset and the hardest to demo-fake: everyone else's plan is a bulleted list from the model's imagination; yours is derived from mapped, real architectures (the Ix subsystem work). "Grounded planning" is a claim competitors can't make without building your pipeline.

3. **Pick the trust-sensitive buyer.** Pure non-technical founders don't value graphs and step evidence — they value the demo, and Lovable will out-demo you. The person these features are built for is the technical founder or developer starting something new who has been burned by black-box generation — someone who wants delegation *with receipts*. Message to their skepticism, not to the dream ("build an app with one prompt"). That skepticism is growing industry-wide, which means this positioning appreciates over time while "one prompt, whole app" depreciates.

The one thing to avoid: positioning as "best of both worlds" (builder + IDE). Hybrid positioning reads as unfocused. The sharper story is sequential — *start where structure matters, see everything the agent does, and never hit the wall because the real IDE was there all along.*
