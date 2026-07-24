import { notFound } from "next/navigation";
import { getDeal, getRecord } from "@/mock/data";
import { stepsFor } from "@/lib/steps";
import { Sidebar } from "@/components/Sidebar";

export default async function DealLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const deal = getDeal(dealId);
  const rec = getRecord(dealId);
  if (!deal || !rec) notFound();

  const steps = stepsFor(dealId, rec);

  return (
    <div className="shell">
      <Sidebar deal={deal} steps={steps} />
      <main className="main">{children}</main>
    </div>
  );
}
