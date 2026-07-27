import type { ScoreType, ScoreValue } from "@/mock/types";

/**
 * rubric_v1 — the six assessment rubrics, 41 sub-dimensions (7/7/7/7/7/6).
 *
 * Transcribed from the Notion "Assessment Rubrics" page (Idea to Enterprises
 * Framework — Working Document). Every `label`, `whatItTests`, `rootsTo`, and
 * anchor string below is the Notion cell verbatim; only Notion's own bold and
 * italic markers and the "Fail:/Unverified:/Pass:" column prefixes were dropped,
 * since the column is already named by the field. Nothing was summarised,
 * reworded, or shortened — a PM reads these anchors to author a score, so a
 * paraphrase here would quietly change what the score means.
 *
 * Anchors are written at 1 / 3 / 5 only; 2 and 4 are the in-betweens. The binary
 * rows relabel those three columns Fail / Unverified / Pass. Rows are ordered
 * highest-signal-first within each rubric, as Notion orders them, and `index`
 * carries that position.
 *
 * Two things this file deliberately does not do. It does not weight anything —
 * there is no total, no composite, and no average anywhere in this codebase
 * (spec D1). And it does not turn the "Feeds at judgment" column into a graph:
 * `feedsAtJudgment` is prose a human reads, because the framework's own rule is
 * that capture feeds judgment and never shares its number.
 */

export type ScaleAnchors = { low: string; mid: string; high: string };
export type BinaryAnchors = { fail: string; unv: string; pass: string };

/**
 * A hygiene floor row, and what tripping it carries.
 *
 * `breachAt` is the one value that trips the floor. On the binary rows that is
 * "fail". On two rows it is the number 1 — Ambition & exit-type fit and Cap-table
 * health are scored 1–5 and killed at 1, not pass/fail, which is exactly the case
 * a "binary rows only" floor check silently misses.
 *
 * `weight` separates a kill from a flag. Engineering self-sufficiency is written
 * as "Flag, not an auto-kill: an elevated, mandatory-clear condition", so it must
 * not read as a deal-dropping Fail — and the framework has an open call on
 * precisely that (spec D5).
 */
export interface FloorRule {
  breachAt: ScoreValue;
  weight: "kill" | "flag";
}

export interface SubDimension {
  key: string;
  /** Position within its rubric, per Notion's highest-signal-first ordering. */
  index: number;
  label: string;
  type: ScoreType;
  /** Notion's "What it tests" — the question the row actually asks. */
  whatItTests: string;
  /** Notion's "Roots to", verbatim, for display. */
  rootsTo: string;
  /**
   * The pillar/track slide keys that column resolves to. Empty on capture rows
   * and floor rows: a capture row is read upward by a human, and a floor row is
   * hygiene, so neither roots to a slide.
   */
  roots: string[];
  anchors: ScaleAnchors | BinaryAnchors;
  /** Set only on hygiene floor rows. */
  floor?: FloorRule;
  /** Notion's "Feeds at judgment" for capture rows. Prose, never a computation. */
  feedsAtJudgment?: string;
  /** An unresolved framework call on this row — "Open for discussion with Srini". */
  open?: string;
}

export interface Rubric {
  key: string;
  label: string;
  blurb: string;
  subs: SubDimension[];
}

export const RUBRICS: Rubric[] = [
  {
    key: "ft",
    label: "Founder & Team",
    blurb: "Scored on what a founder did — built, hired, shipped, raised. Highest signal first.",
    subs: [
      {
        key: "earned-insight",
        index: 1,
        label: "Founder–market fit & earned insight",
        type: "scale",
        whatItTests:
          "Firsthand exposure to this exact market, and a specific counter-consensus insight an expert would " +
          "validate",
        rootsTo: "Earned secret pillar",
        roots: ["earned-secret"],
        anchors: {
          low:
            "No firsthand exposure; the insight is generic or reachable by any analyst in a week; picked the " +
            "space top-down for its market size",
          mid:
            "Real proximity to the problem and a plausible non-obvious insight, but stated not " +
            "expert-validated, and traceable to reading more than to doing",
          high:
            "Deep firsthand or proprietary exposure to this exact market, and a specific counter-consensus " +
            "insight — predating the opportunity — that an expert in the space confirms",
        },
      },
      {
        key: "learning-rate",
        index: 2,
        label: "Learning rate & execution cadence",
        type: "scale",
        whatItTests: "Speed of the hypothesis → test → kill → ship loop, and visible movement between calls",
        rootsTo: "Founder/s track",
        roots: ["founder"],
        anchors: {
          low: "Same story and same gaps across weeks; defends the original plan; no hypothesis has been killed",
          mid:
            "Iterates when pushed and can point to past pivots, but the loop is slow and reactive rather than " +
            "owned",
          high:
            "Runs a fast, self-driven test → kill → ship loop, out-paces peers, and visibly moved the product, " +
            "thesis, or numbers between two calls",
        },
      },
      {
        key: "track-record",
        index: 3,
        label: "Track record & prior 0-to-1 building",
        type: "scale",
        whatItTests: "Whether they have built something from zero before, with a credible outcome",
        rootsTo: "Founder/s track",
        roots: ["founder"],
        anchors: {
          low: "No 0-to-1 history; only large-company or operational roles where the path was already laid",
          mid:
            "Was early at something that scaled, or built a smaller venture or side project — contributed to a " +
            "0-to-1 but did not own the hardest part",
          high:
            "Founded or was a core builder of something from zero to a real outcome — scale, revenue, or exit — " +
            "owning the hardest part",
        },
      },
      {
        key: "coachability",
        index: 4,
        label: "Coachability & collaboration fitness",
        type: "scale",
        whatItTests: "Seeks hard feedback, names their own gaps first, wants a co-builder not just capital",
        rootsTo: "Founder/s track",
        roots: ["founder"],
        anchors: {
          low: "Deflects or argues down feedback; presents as complete; wants the money and to be left alone",
          mid:
            "Takes feedback well in the room and wants a co-builder in principle, but coachability proper is " +
            "untested — no gap named unprompted, no feedback yet acted on",
          high:
            "Surfaces their own gaps unprompted, actively pulls for hard feedback, and has already acted on " +
            "outside input — visibly wants co-building, not just a cheque",
        },
        open:
          "D5 — whether co-founder dynamics (in case more than 1 co-founders) earns its own row, or stays under " +
          "this one",
      },
      {
        key: "drive-resilience",
        index: 5,
        label: "Drive, resilience & durability",
        type: "scale",
        whatItTests: "Problem-obsession that predates the opportunity, and having pushed through real adversity",
        rootsTo: "Founder/s track",
        roots: ["founder"],
        anchors: {
          low:
            "Opportunistic interest in the space; no adversity story, or folds when the plan first meets " +
            "friction",
          mid:
            "Committed and working hard, but the pull is recent and opportunity-driven, and the adversity " +
            "described is ordinary, not tested",
          high:
            "Problem-obsessed for reasons that predate the opportunity, and has pushed through real adversity — " +
            "funding, personal cost, the near-death of a prior effort — and kept going",
        },
      },
      {
        key: "communication",
        index: 6,
        label: "Communication & storytelling",
        type: "scale",
        whatItTests: "Explains it simply and magnetically; people have already joined, bought, or funded off the story",
        rootsTo: "Founder-led storytelling pillar",
        roots: ["founder-storytelling"],
        anchors: {
          low: "Rambling or jargon-heavy; cannot say what they do in a line; no one has moved off the story",
          mid:
            "Clear and credible explanation, but the pull is unproven — no one has yet joined, bought, or " +
            "funded because of it",
          high:
            "Explains it simply and magnetically, and has already pulled talent, customers, or capital off the " +
            "story, with genuine founder–problem fit underneath rather than a polished pitch",
        },
      },
      {
        key: "ambition-fit",
        index: 7,
        label: "Ambition & exit-type fit",
        type: "scale",
        whatItTests: "Building unambiguously for a venture-scale outcome, and accepting what that takes",
        rootsTo: "Founder/s track (kill-floor at 1)",
        roots: ["founder"],
        anchors: {
          low: "Lifestyle, services, or early-acquihire intent — venture-scale is not the goal",
          mid:
            "Says venture-scale, but the plan or the appetite for risk reads smaller; ambition stated, not yet " +
            "backed by choices",
          high:
            "Unambiguously building a venture-scale outcome, and the choices — market, model, hiring, dilution " +
            "appetite — match what that takes",
        },
        floor: { breachAt: 1, weight: "kill" },
      },
    ],
  },
  {
    key: "pm",
    label: "Problem & Market",
    blurb: "Scored on what buyers do, not what founders say. Highest signal first.",
    subs: [
      {
        key: "problem-intensity",
        index: 1,
        label: "Problem intensity & urgency",
        type: "scale",
        whatItTests: "How frequent, costly, and actively-worked-on the pain is now",
        rootsTo: "Market track",
        roots: ["market"],
        anchors: {
          low: "Nice-to-have; infrequent or low-cost pain, no workaround in place, no one accountable for a fix",
          mid:
            "Real recurring pain, acknowledged and worked around, but tolerated — no deadline, not anyone's job " +
            "to solve",
          high:
            "Frequent, quantifiably expensive pain the buyer is spending time or money on now, with a " +
            "workaround they resent and someone accountable for a fix",
        },
      },
      {
        key: "problem-validation",
        index: 2,
        label: "Problem validation",
        type: "scale",
        whatItTests: "Evidence beyond the founder — independent, ideally behavioural",
        rootsTo: "Market track",
        roots: ["market"],
        anchors: {
          low: "Founder's assertion only, or confirmation from their own network",
          mid: "Several independent buyers confirm it when asked; evidence stated, not yet behavioural",
          high:
            "Independent buyers raise it unprompted and back it with behaviour — built workarounds, assigned " +
            "budget, joined as design partners",
        },
      },
      {
        key: "why-now",
        index: 3,
        label: "Why-now / timing thesis",
        type: "scale",
        whatItTests: "Whether a real causal shift makes this winnable now, not before",
        rootsTo: "Earned secret pillar",
        roots: ["earned-secret"],
        anchors: {
          low: "No timing logic, or a generic tailwind (\"AI\", \"big market\") with no link to this problem",
          mid: "A real shift is named and plausibly linked, but rests on narrative — no leading indicators yet",
          high:
            "A specific, recent, causal shift (regulation, a cost-curve crossing, a behaviour change) with " +
            "leading indicators, that explains why now and not two years ago",
        },
      },
      {
        key: "willingness-to-pay",
        index: 4,
        label: "Demand & willingness to pay",
        type: "scale",
        whatItTests: "Revealed willingness to pay, not inferred",
        rootsTo: "Market track",
        roots: ["market"],
        anchors: {
          low: "WTP inferred by the founder; no budget owner or current spend named",
          mid: "A budget line and rough current spend are known; willingness stated, not tested with a real number",
          high:
            "Quantified current spend, a named budget owner, and revealed WTP — a price quoted and accepted, an " +
            "LOI, or a paid pilot",
        },
      },
      {
        key: "root-cause",
        index: 5,
        label: "Root cause & scope",
        type: "scale",
        whatItTests: "Why the problem has persisted, and exactly who it bites",
        rootsTo: "Earned secret pillar + Market track",
        roots: ["earned-secret", "market"],
        anchors: {
          low: "Symptoms only; no view on why it stays unsolved or precisely who has it",
          mid: "A credible root-cause account and a rough sense of the affected segment",
          high:
            "Names the non-obvious reason it has persisted, and maps precisely which segment feels it most and " +
            "how widely it spreads",
        },
      },
      {
        key: "market-size",
        index: 6,
        label: "Market size — ownable niche",
        type: "scale",
        whatItTests: "An ownable niche with evidenced propensity to pay, not raw TAM",
        rootsTo: "Market track",
        roots: ["market"],
        anchors: {
          low: "Top-down TAM only, on unexamined assumptions; or a huge market with no owned entry point",
          mid: "A bottoms-up sketch on soft assumptions; a beachhead named but propensity to pay unproven",
          high:
            "A sharp beachhead the team can own, with high evidenced propensity to pay, and a defensible " +
            "bottoms-up path from it to a $1B+ business",
        },
        open: "D5 — whether Market size stays scored here, given the venture-scale binary sits in hygiene",
      },
      {
        key: "competitive-landscape",
        index: 7,
        label: "Competitive landscape & whitespace",
        type: "scale",
        whatItTests: "An honest read of every alternative incl. the status quo, and a real structural gap",
        rootsTo: "Market track",
        roots: ["market"],
        anchors: {
          low: "\"No competitors\", or blind to obvious ones; ignores the do-nothing alternative",
          mid:
            "Names direct players, but thin on indirect and status-quo alternatives; the gap is asserted, not " +
            "evidenced",
          high:
            "Maps direct, indirect, and do-nothing alternatives, names a structural gap, and shows no " +
            "entrenched leader owns the beachhead",
        },
      },
    ],
  },
  {
    key: "pt",
    label: "Product / Tech & Solution",
    blurb:
      "Scored on what the tech does for the problem and whether it compounds — not how much is built. Highest " +
      "signal first.",
    subs: [
      {
        key: "problem-solution-fit",
        index: 1,
        label: "Problem–solution fit",
        type: "scale",
        whatItTests:
          "Whether the solution is a step-change — not a marginal gain — on the one metric the buyer decides " +
          "on, felt not claimed, with a sharp one-line value prop",
        rootsTo: "capture",
        roots: [],
        anchors: {
          low:
            "A feature or nice-to-have; value prop is generic or many-things-to-many-people; the improvement is " +
            "marginal or founder-asserted, and no buyer has felt a step-change",
          mid:
            "Sharp value prop mapped to a real pain, and a plausible step-change on the metric the buyer " +
            "decides on — but it is demoed or stated, not yet felt by a customer in production",
          high:
            "A customer felt the step-change on the metric they decide on — named the before/after, changed a " +
            "workflow, paid or expanded because of it — and the value prop is one sharp line",
        },
        feedsAtJudgment: "Market track (is it wanted), and a reality-check on every pillar's \"does it actually deliver\"",
      },
      {
        key: "foundational-tech",
        index: 2,
        label: "Foundational tech & IP",
        type: "scale",
        whatItTests:
          "Whether the method is genuinely hard to reproduce — deep research, hard engineering, or a real lead " +
          "— not a thin wrapper on a rented model",
        rootsTo: "Foundational tech pillar",
        roots: ["foundational-tech"],
        anchors: {
          low:
            "A thin wrapper on a rented model or off-the-shelf parts any funded team assembles in a quarter; " +
            "\"hard tech\" claimed but no barrier named, no time-to-parity",
          mid:
            "A real engineering or research lead is described and plausible, but the barrier and time-to-parity " +
            "are founder-stated, not independently validated, and it is unclear the lead keeps widening with " +
            "use",
          high:
            "A novel or 10x capability with a named, checkable barrier, independently validated, with years of " +
            "time-to-parity that widens with use — a funded team cannot close it in a quarter",
        },
      },
      {
        key: "compounding-moat",
        index: 3,
        label: "Compounding moat mechanism",
        type: "scale",
        whatItTests:
          "Whether usage feeds an owned dataset, workflow or network advantage competitors cannot assemble by " +
          "copying the software",
        rootsTo: "Cornered resource pillar",
        roots: ["cornered-resource"],
        anchors: {
          low:
            "No compounding loop; a \"head start\" that is just software, copyable in a quarter; or a plan to " +
            "accumulate data later with nothing owned today",
          mid:
            "A credible loop is described — usage throws off proprietary data or workflow that should improve " +
            "the product — but it is early, the asset is not yet owned or exclusive, and there is no evidence " +
            "it is widening",
          high:
            "A live loop where usage produces an owned, hard-to-assemble asset — proprietary dataset, workflow " +
            "lock, network — that visibly compounds and is checkable today; copying the software does not copy " +
            "it",
        },
      },
      {
        key: "time-to-value",
        index: 4,
        label: "Time-to-value & implementation burden",
        type: "scale",
        whatItTests: "How fast the buyer sees value, and how heavy the deployment and per-client configuration lift is",
        rootsTo: "capture",
        roots: [],
        anchors: {
          low:
            "Long, heavy implementation — months of integration or per-client config, services-like lift — " +
            "before any value; value visible only in quarters",
          mid:
            "Light front door, but full value gated on a stated maturation or configuration period; the " +
            "timeline is asserted, not evidenced by a customer",
          high:
            "Fast time-to-value — light-touch deployment into tools the buyer already uses, value visible in " +
            "days, and a customer has confirmed the quick payoff",
        },
        feedsAtJudgment: "GTM engine pillar and Market track (sale speed); studio build-math",
      },
      {
        key: "architecture",
        index: 5,
        label: "Architecture & scalability",
        type: "scale",
        whatItTests: "Whether the architecture is modular, scalable by design, and deployable where the buyer requires",
        rootsTo: "capture",
        roots: [],
        anchors: {
          low:
            "Brittle or monolithic; scaling, multi-tenancy or deployment constraints unaddressed; cannot deploy " +
            "where the buyer needs it",
          mid:
            "A sensible architecture and a scaling story, but stated not stress-tested; deployment flexibility " +
            "claimed, not shown at load or across clients",
          high:
            "Modular and scalable by design, shown across multiple deployments or at load, and deployable where " +
            "the buyer requires — their cloud or on-prem — without a rebuild",
        },
        feedsAtJudgment: "Foundational tech pillar (corroboration), and hygiene (deployable where the buyer requires)",
      },
      {
        key: "wedge",
        index: 6,
        label: "Wedge & path to leadership",
        type: "scale",
        whatItTests:
          "Whether there is a sharp, winnable wedge and a credible path from it to a control point in the " +
          "larger market",
        rootsTo: "capture",
        roots: [],
        anchors: {
          low:
            "No wedge — boil-the-ocean scope, or a wedge with no path beyond it; platform ambition with no " +
            "beachhead",
          mid:
            "A sharp wedge is named and plausible, but the path from wedge to a broader control point is " +
            "narrative, not yet evidenced by early expansion",
          high:
            "A sharp, winnable wedge already landing, with a credible, evidenced path to a control point — " +
            "data, workflow, or integration lock — in the larger market; land-and-expand visible in real " +
            "accounts",
        },
        feedsAtJudgment: "Market track, and the control-point / cornered-resource read",
      },
      {
        key: "product-state",
        index: 7,
        label: "Product state & readiness",
        type: "scale",
        whatItTests:
          "Whether what is built is right-sized for the stage: enough to test with real users, not gold-plated " +
          "ahead of validation",
        rootsTo: "capture",
        roots: [],
        anchors: {
          low:
            "Nothing testable yet — slides or vision only; or the opposite, heavily over-built and polished " +
            "ahead of any validated demand",
          mid:
            "A working product in real use, but slightly ahead of validated demand, or with thin evidence that " +
            "the built surface maps to what users actually pull on",
          high:
            "Right-sized for the stage — enough in real users' hands to learn fast, built only where validation " +
            "justified it, with the roadmap gated on evidence not ambition",
        },
        feedsAtJudgment: "Studio-fit read, a reality-check on all pillar claims, and hygiene (engineering self-sufficiency)",
      },
    ],
  },
  {
    key: "gtm",
    label: "GTM & Distribution Access",
    blurb:
      "Scored on what buyers did — signed, paid, expanded. Privileged distribution (#4/#5) is critical; GTM " +
      "engine (#1–#3) is fillable. Highest signal first.",
    subs: [
      {
        key: "selling-motion",
        index: 1,
        label: "Repeatable selling motion",
        type: "scale",
        whatItTests:
          "Whether there is a machine — a defined cycle, tracked conversion, known CAC — that closes repeatably " +
          "across similar buyers, not a handful of founder-closed one-offs",
        rootsTo: "GTM engine pillar",
        roots: ["gtm-engine"],
        anchors: {
          low:
            "No motion; any deals are founder-closed one-offs, each different; no defined cycle, no conversion " +
            "or CAC view; \"we'll sort sales out later\"",
          mid:
            "A motion is described — stages, a rough cycle length, a pattern across a few deals — but it is " +
            "founder-run and stated, not yet shown to repeat with consistent conversion or a known CAC",
          high:
            "A repeatable motion shown across multiple similar buyers — consistent cycle length, tracked stage " +
            "conversion, known CAC and payback — that closes without the founder in every room",
        },
      },
      {
        key: "icp-precision",
        index: 2,
        label: "ICP precision",
        type: "scale",
        whatItTests:
          "A specific buyer — niche + role + confirmation that role holds budget — not a broad segment or an " +
          "inferred persona",
        rootsTo: "GTM engine pillar",
        roots: ["gtm-engine"],
        anchors: {
          low:
            "Broad or shifting segment (\"mid-market enterprises\"); buyer role vague; no budget-authority " +
            "confirmation; or the ICP is teed up and never delivered",
          mid:
            "A niche and a buyer role are named and plausible, but budget authority is asserted not confirmed, " +
            "and the in/out boundary is soft",
          high:
            "A sharp niche, a named buyer role, and confirmation that role holds the budget — evidenced by who " +
            "actually bought — with a clear in/out boundary the first accounts already fit",
        },
      },
      {
        key: "buying-unit",
        index: 3,
        label: "Buying unit & champion map",
        type: "scale",
        whatItTests:
          "The roles in the deal — economic buyer, champion, technical validator — named for real deals, with " +
          "who signs and who pays",
        rootsTo: "GTM engine pillar",
        roots: ["gtm-engine"],
        anchors: {
          low:
            "No buying-unit map; \"the CEO decides\" hand-wave; champion, economic buyer and validator not " +
            "distinguished",
          mid:
            "The three roles are named and mapped for a sample deal, but stated — no evidence a champion drove " +
            "a deal or the named economic buyer actually signed",
          high:
            "The buying unit mapped from real closed deals — a named champion who drove it, the economic buyer " +
            "who signed, the validator who cleared it — and the pattern repeats across accounts",
        },
      },
      {
        key: "privileged-access",
        index: 4,
        label: "Privileged distribution — access",
        type: "scale",
        whatItTests: "Whose door opens for the founder that others would need years or serious money to replicate",
        rootsTo: "Privileged distribution pillar (critical)",
        roots: ["privileged-distribution"],
        anchors: {
          low:
            "No privileged access; the plan is cold outbound or \"we'll build a network\"; or the founder's whole " +
            "ask is for someone else to open the doors — access is the gap, not the asset",
          mid:
            "Real warm access to some named buyers or a channel, but replicable — the kind a well-networked " +
            "founder assembles in months — or narrow to a few relationships",
          high:
            "Access to buyers a competitor would need years or serious money to build — an earned position " +
            "inside the industry, an institutional channel — evidenced by doors that actually opened",
        },
      },
      {
        key: "access-credibility",
        index: 5,
        label: "Credibility to convert that access",
        type: "scale",
        whatItTests: "Whether buyers act on the access — sign, pay, expand — not just take the meeting",
        rootsTo: "Privileged distribution pillar (critical)",
        roots: ["privileged-distribution"],
        anchors: {
          low:
            "Access opens a door once; no evidence anyone acted; reach without credibility — a contact list or " +
            "a follower count",
          mid:
            "Meetings happen and interest is real, but conversion off the access is stated (a claimed close " +
            "rate), not shown — buyers took the meeting, have not yet signed off the relationship",
          high:
            "Buyers act on the access — signed, paid, expanded — because they trust the founder, shown across " +
            "more than one relationship; the access converts, it does not just open",
        },
      },
      {
        key: "channel-reach",
        index: 6,
        label: "Channel & scalable reach",
        type: "scale",
        whatItTests:
          "Whether reach scales beyond the founder — partner-led or platform-led leverage — or every deal needs " +
          "the founder in the room",
        rootsTo: "capture",
        roots: [],
        anchors: {
          low:
            "No channel; all reach is founder-led and does not scale; \"we'll hire sales later\" with no leverage " +
            "identified",
          mid:
            "A channel or partner motion is named and plausible — a signed partner, a platform ecosystem — but " +
            "unproven; no deal has come through it yet",
          high:
            "A channel is producing — partners or a platform ecosystem sourcing or closing deals without the " +
            "founder — with deals attributed to the channel, not the founder's calendar",
        },
        feedsAtJudgment:
          "GTM engine pillar (scale of the motion), Privileged distribution (if the channel is itself the " +
          "access), and Market track (reach); studio build-math",
      },
      {
        key: "pricing-packaging",
        index: 7,
        label: "Pricing, packaging & motion fit",
        type: "scale",
        whatItTests:
          "Whether pricing and packaging fit the motion and the buyer's budget cycle — land size, value metric, " +
          "expansion path — so value is captured repeatably",
        rootsTo: "capture",
        roots: [],
        anchors: {
          low:
            "No pricing logic, or pricing that fights the motion — a big upfront ask into a bottoms-up motion, " +
            "a value metric buyers do not recognize, or \"we'll price later\"",
          mid:
            "A pricing model and packaging are defined and sensibly matched to the motion (land small, expand " +
            "on a value metric), but stated — not yet shown to hold at renewal or expansion",
          high:
            "Pricing and packaging proven to fit the motion — lands at a size the buyer clears easily, expands " +
            "on a value metric that grows with usage, holds at renewal — shown across real accounts",
        },
        feedsAtJudgment:
          "GTM engine pillar (motion fit), Business-model innovation (only if the pricing counter-positions an " +
          "incumbent), and Market track",
      },
    ],
  },
  {
    key: "fl",
    label: "Financial & Legal",
    blurb:
      "Scored on what filings and agreements show, not verbal assurance. Binary rows read Fail / Unverified / " +
      "Pass. Cheapest, highest-kill-load check first.",
    subs: [
      {
        key: "capital-cleanliness",
        index: 1,
        label: "Capital & stage cleanliness",
        type: "binary",
        whatItTests:
          "No institutional funding raised; no outstanding convertible notes, SAFEs, venture debt, or loans on " +
          "the entity — the stage is clean for a studio equity build",
        rootsTo: "Floor",
        roots: [],
        anchors: {
          fail:
            "an institutional round closed (priced, SAFE or note), venture debt, or undisclosed " +
            "convertibles/loans sit on the books — outside capital or liabilities a studio build cannot sit on " +
            "top of",
          unv:
            "not asked, or founder-stated \"we're clean / bootstrapped\" with no bank statements, filings, or " +
            "note register seen. Advances to agenda; not a kill",
          pass:
            "filings, bank statements, and a nil note/debt register confirm no institutional funding and no " +
            "outstanding notes or debt; any angel/friends money is disclosed and sits as clean equity (read at " +
            "#5)",
        },
        floor: { breachAt: "fail", weight: "kill" },
      },
      {
        key: "ip-ownership",
        index: 2,
        label: "IP ownership & cleanliness",
        type: "binary",
        whatItTests:
          "The team owns and controls all IP used; assignment is executed; no prior-employer, ex-founder, or " +
          "licence claim bleeds in",
        rootsTo: "Floor",
        roots: [],
        anchors: {
          fail:
            "IP built on a prior employer's time/tools/domain with no release; a departed co-founder or " +
            "contractor holds unassigned code; OSS/licence terms that poison commercial use; assignment " +
            "agreements missing where they must exist",
          unv:
            "not asked, or \"it's sorted\" with no assignment agreements seen. Elevated to a mandatory-clear " +
            "condition when a specific prior-employer or ex-contributor boundary is visible. Advances to " +
            "agenda; not a G1 kill",
          pass:
            "executed IP-assignment agreements from every founder and contributor; a clean prior-employer " +
            "boundary (release, or work provably outside scope); OSS/licence terms reviewed and clear",
        },
        floor: { breachAt: "fail", weight: "kill" },
        open: "D5 — the flagged prior-employer IP boundary: advance-with-condition at G1 vs hold at G1",
      },
      {
        key: "india-incorporation",
        index: 3,
        label: "India incorporation & entity structure",
        type: "binary",
        whatItTests:
          "The operating entity is incorporated in India, with a structure clean enough for a studio equity " +
          "build — no opaque holdco or completed flip that blocks it",
        rootsTo: "Floor",
        roots: [],
        anchors: {
          fail:
            "not incorporated in India, or a structure that blocks the build — a flip already done, a foreign " +
            "parent, or a tangle of entities where ownership of IP and revenue is unclear",
          unv:
            "not asked, or registration stated but jurisdiction/entity type unconfirmed and no incorporation " +
            "certificate seen (\"registered a company\", country unstated). Advances to agenda; not a kill",
          pass:
            "incorporation certificate confirms an Indian entity; the structure is single-entity or a clean, " +
            "explained holding structure with IP and revenue in the right place",
        },
        floor: { breachAt: "fail", weight: "kill" },
      },
      {
        key: "regulated-readiness",
        index: 4,
        label: "Regulated-space readiness",
        type: "binary",
        whatItTests:
          "Where the space is regulated, the team holds the domain expertise and any required licences or " +
          "approvals. Where it is not, this is a clean N/A pass",
        rootsTo: "Floor",
        roots: [],
        anchors: {
          fail:
            "the space needs a licence/approval (lending, health, payments, a data-localisation regime) and the " +
            "team has neither the licence nor a credible path and expertise to hold it — a compliance wall they " +
            "cannot clear",
          unv:
            "regulated exposure is plausible but the licensing/compliance posture was not probed, or is stated " +
            "without evidence (an answer given, nothing certified). Advances to agenda; not a kill",
          pass:
            "either the space is not licence-gated (clean N/A), or the required licences/approvals are held or " +
            "credibly in hand with the domain expertise to keep them, and data-handling obligations (e.g. DPDP) " +
            "are addressed and evidenced",
        },
        floor: { breachAt: "fail", weight: "kill" },
      },
      {
        key: "cap-table-health",
        index: 5,
        label: "Cap-table health",
        type: "scale",
        whatItTests:
          "Founder ownership intact, clean vested splits, meaningful ESOP room, no dead equity, no problematic " +
          "prior investors or control terms",
        rootsTo: "Floor (kill-floor at 1)",
        roots: [],
        anchors: {
          low:
            "Broken table — founders diluted below working control, large dead equity (a departed founder or " +
            "advisor sitting on a big idle stake), or a prior investor with predatory control or economics. A 1 " +
            "is a kill-floor",
          mid:
            "Structure stated and broadly sane — a rough founder split and an ESOP plan — but no cap-table " +
            "document seen; splits, vesting, and any angel terms asserted, not verified",
          high:
            "Cap table on paper confirms intact founder ownership, clean vested splits, no dead equity, " +
            "standard ESOP room, and any angels on clean minority terms with no control drag",
        },
        floor: { breachAt: 1, weight: "kill" },
      },
      {
        key: "capital-efficiency",
        index: 6,
        label: "Capital efficiency & burn discipline",
        type: "scale",
        whatItTests:
          "Whether the plan reaches its milestones on sane capital, or is OpEx-heavy / structurally low-margin " +
          "— the structural-margin read also feeds the structural-fit floor",
        rootsTo: "capture (+ structural-fit floor)",
        roots: [],
        anchors: {
          low:
            "Structurally capital-hungry or low-margin — a services/headcount-linear cost base, heavy ongoing " +
            "OpEx, or margins that stay thin at scale; the plan needs outsized capital to reach the next " +
            "milestone. A structural-low-margin read trips the structural-fit floor",
          mid:
            "A lean, software-margin posture is described and plausible, but stated — no revealed burn, runway, " +
            "or spend history to confirm the plan reaches milestones on the capital claimed",
          high:
            "A software-margin cost base and disciplined burn shown in the numbers — spend history and runway " +
            "that reach the stated milestones on sane capital, with the margin structure clean at scale",
        },
        feedsAtJudgment:
          "Structural-fit floor (OpEx-heavy or structurally low-margin is a hygiene kill), and studio " +
          "build-math (capital to the next milestone)",
      },
      {
        key: "financial-model",
        index: 7,
        label: "Financial model & unit-economics honesty",
        type: "scale",
        whatItTests:
          "Whether the basic model is coherent and, at depth, whether the unit economics (CAC, payback, gross " +
          "margin, cohort behaviour) are honest and hold up",
        rootsTo: "capture",
        roots: [],
        anchors: {
          low:
            "The model is incoherent or dishonest — margins that ignore delivery cost, a CAC/payback that " +
            "cannot be true, top-line growth with no unit backing",
          mid:
            "A basic model is captured and internally coherent — land price, expansion path, target — but the " +
            "unit economics behind it are unbuilt or unverified; a stated-only model caps here at L1",
          high:
            "Unit economics built and honest — CAC, payback, gross margin, and cohort retention evidenced from " +
            "real accounts and consistent with the model, typically once the data room opens at L2/IC",
        },
        feedsAtJudgment:
          "Market track and studio build-math (the unit economics behind the model); business-model innovation " +
          "only if the deal or pricing structure is itself legacy-breaking — otherwise it stays with GTM #7",
      },
    ],
  },
  {
    key: "sf",
    label: "Studio Fit & Co-Develop",
    blurb:
      "Scored on what the founder shared, conceded, and acted on toward the studio deal. Binary rows read Fail " +
      "/ Unverified / Pass. Cheapest, highest-kill-load check first.",
    subs: [
      {
        key: "studio-alignment",
        index: 1,
        label: "Studio-model alignment",
        type: "binary",
        whatItTests:
          "The founder wants genuine co-building and accepts the studio equity model — real dilution for a " +
          "co-founder — not just cheap capital and door-opening dressed up as co-building",
        rootsTo: "Floor",
        roots: [],
        anchors: {
          fail:
            "wants a cheque and a rolodex, not a co-builder — rejects the equity model outright, or the " +
            "\"co-build\" ask is outsourced distribution/capital with the founder keeping full ownership and " +
            "control",
          unv:
            "co-building appetite stated and the studio ask is informed, but the reaction to the actual " +
            "equity/dilution model is untested — the model was explained, the founder never reacted. Advances " +
            "to agenda; not a kill",
          pass:
            "the founder has seen the equity model and conceded on it — accepts studio-level dilution for a " +
            "co-founder, evidenced by what they agreed to, not a stated openness to help",
        },
        floor: { breachAt: "fail", weight: "kill" },
      },
      {
        key: "eng-self-sufficiency",
        index: 2,
        label: "Engineering self-sufficiency",
        type: "binary",
        whatItTests: "The team can build and own its own product — the one function Biome does not backfill",
        rootsTo: "Floor",
        roots: [],
        anchors: {
          fail:
            "no in-house engineering ownership — the team cannot build or run its own product and needs the " +
            "studio to supply and hold the core build. Flag, not an auto-kill: an elevated, mandatory-clear " +
            "condition",
          unv: "not asked, or engineering strength asserted with no view of who owns the stack",
          pass:
            "the founders/team own and run the core stack themselves, evidenced by who built what — the studio " +
            "doubles down, it does not supply the build",
        },
        floor: { breachAt: "fail", weight: "flag" },
        open: "D5 — engineering self-sufficiency, flag vs hard kill",
      },
      {
        key: "founder-commitment",
        index: 3,
        label: "Founder commitment",
        type: "binary",
        whatItTests: "All co-founders full-time, or on a clear, dated timeline to be",
        rootsTo: "Floor",
        roots: [],
        anchors: {
          fail:
            "a co-founder is part-time or hedged with no timeline to go full-time — the team is not all-in on " +
            "the build",
          unv:
            "the founders appear engaged but full-time status was never explicitly confirmed (\"both building\" " +
            "with no commitment stated). Advances to agenda; not a kill",
          pass: "every co-founder confirmed full-time, or a specific dated timeline for anyone not yet",
        },
        floor: { breachAt: "fail", weight: "kill" },
      },
      {
        key: "structural-fit",
        index: 4,
        label: "Structural fit — software-tech",
        type: "binary",
        whatItTests:
          "A software-tech product the studio can co-build — excludes services, D2C / consumer, manufacturing / " +
          "commodities, hardware-integrated deep tech, and OpEx-heavy / structurally low-margin models. The " +
          "margin read is shared with Financial & Legal #6",
        rootsTo: "Floor (shared with Financial #6)",
        roots: [],
        anchors: {
          fail:
            "fundamentally a services, D2C, manufacturing, hardware-integrated, or structurally low-margin " +
            "business — not a software-margin venture a studio can build. A structural-low-margin read comes " +
            "from Financial #6",
          unv:
            "the product looks like software but the model/margin structure was not probed — the " +
            "services-vs-product line is unclear",
          pass:
            "a software-tech product on a software-margin structure — the margin read confirmed via Financial " +
            "#6",
        },
        floor: { breachAt: "fail", weight: "kill" },
      },
      {
        key: "fillable-gap-fit",
        index: 5,
        label: "Fillable-gap fit",
        type: "scale",
        whatItTests:
          "Whether there is a real fillable-pillar gap — GTM engine, founder-led storytelling, or " +
          "business-model innovation — that the studio is positioned to close, matched to the founder type. " +
          "Reads the gap only; never re-scores a pillar",
        rootsTo: "capture (fillable-pillar read)",
        roots: [],
        anchors: {
          low:
            "No fillable gap the studio can close — either the founder is already strong on all three fillable " +
            "pillars (nothing to add), or the gap sits in a critical pillar the studio cannot supply (earned " +
            "secret, foundational tech, cornered resource, privileged distribution), so \"help\" is really asking " +
            "the studio to be the founder",
          mid:
            "A plausible fillable gap exists and is matched to the founder type, but the founder frames the ask " +
            "around a critical pillar the studio can't fill (distribution/access), so the fit is real but " +
            "muddied — or the gap is stated, not yet evidenced by what the founder already owns",
          high:
            "A clear fillable-pillar gap the studio is demonstrably positioned to close, matched to a founder " +
            "whose strength sits elsewhere — the studio doubles down on the founder's proven pillar and builds " +
            "the fillable one, evidenced by what the founder owns versus what is genuinely missing",
        },
        feedsAtJudgment:
          "The fillable-pillar read (GTM engine / storytelling / business-model) as a gap-and-positioning input " +
          "— never as a pillar score; and studio build-math",
      },
      {
        key: "codev-willingness",
        index: 6,
        label: "Co-building willingness & partner signal",
        type: "scale",
        whatItTests:
          "Revealed behaviour toward the studio as a partner — materials shared on time, feedback acted on " +
          "between calls, responsiveness — not a stated appetite for co-building",
        rootsTo: "capture (studio-fit / co-creation)",
        roots: [],
        anchors: {
          low:
            "Unresponsive or extractive — treats the studio as a vendor or a cheque, materials promised and " +
            "never delivered, feedback ignored, or wants the studio's access and capital while keeping full " +
            "control",
          mid:
            "Strong stated appetite to co-build and an informed studio ask, but revealed partner behaviour is " +
            "not yet observable — a single call, or materials promised and still pending; a stated-only " +
            "appetite caps here",
          high:
            "Revealed partner behaviour across the arc — shared materials on time, acted on hard feedback " +
            "between calls, responsive and straight — the founder behaves like a co-builder, not just says they " +
            "want one",
        },
        feedsAtJudgment:
          "The studio-fit call and the L3 co-creation read; corroborates or contradicts Founder & Team #4 " +
          "coachability without re-scoring it",
      },
    ],
  },
];

/**
 * The framework's unresolved calls, carried in code so they cannot be forgotten.
 *
 * The four row-scoped ones also appear as `open` on their sub-dimension, which is
 * what the capture grid surfaces at scoring time. The two framework-wide ones
 * have no row to hang off: gate logic is the reason this build reports facts and
 * no verdict (spec D1), and founder-type weighting is why the overlay sets a
 * floor dimension rather than re-weighting anchors (spec D3).
 */
export const OPEN_CALLS: { scope: string; question: string; subKey?: string }[] = [
  {
    scope: "Framework-wide",
    question: "Founder-type weighting — how far the anchors flex for technical vs corporate/domain vs serial founders",
  },
  {
    scope: "Framework-wide",
    question: "Gate logic — pass thresholds at G1/G2/G3/IC, and whether each gate is binary or reads the slides",
  },
  {
    scope: "Founder & Team",
    subKey: "coachability",
    question: "Whether co-founder dynamics (in case more than 1 co-founders) earns its own row, or stays under #4",
  },
  {
    scope: "Problem & Market",
    subKey: "market-size",
    question: "Whether Market size (#6) stays scored here, given the venture-scale binary sits in hygiene",
  },
  {
    scope: "Financial & Legal",
    subKey: "ip-ownership",
    question: "The flagged prior-employer IP boundary — advance-with-condition at G1 vs hold at G1",
  },
  {
    scope: "Studio Fit & Co-Develop",
    subKey: "eng-self-sufficiency",
    question: "Engineering self-sufficiency — flag vs hard kill",
  },
];
