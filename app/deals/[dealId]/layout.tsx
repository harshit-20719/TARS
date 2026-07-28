import { notFound } from "next/navigation";
import { getDeal, getRecord } from "@/lib/data";
import { stepsFor, progressOf, viewsFor } from "@/lib/steps";
import { computeRollup } from "@/lib/rollup";
import { Sidebar } from "@/components/Sidebar";
import { StatusLine, type StatusSeg } from "@/components/StatusLine";

export default async function DealLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const [deal, rec] = await Promise.all([getDeal(dealId), getRecord(dealId)]);
  if (!deal || !rec) notFound();

  const steps = stepsFor(dealId, rec);
  const views = viewsFor(dealId, rec);
  const p = progressOf(rec);
  const roll = computeRollup(rec);

  const segments: StatusSeg[] = [
    { label: "REC", value: dealId, tone: "accent" },
    { label: "LAYER", value: deal.layer },
    { label: "SCORED", value: `${p.scored}/${p.total}` },
    { label: "SLIDES", value: `${p.slides}/${p.totalSlides}` },
    { label: "FLOOR", value: roll.floorStatus === "fail" ? "FAILED" : "CLEAR", tone: roll.floorStatus === "fail" ? "bad" : "good" },
  ];
  if (roll.flags.length > 0) segments.push({ label: "FLAGS", value: String(roll.flags.length), tone: "warn" });

  return (
    <div className="shell">
      <Sidebar deal={deal} steps={steps} views={views} />
      <main className="main">{children}</main>
      <StatusLine segments={segments} />
    </div>
  );
}
