import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { Callout, Card } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function SelfServicePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  return (
    <>
      <PageHeader kicker="S27 / customer self-service" title="Customer self-service (deferred, P2)" lead="Not part of the Phase 1 demo. This page documents the deferred scope so nothing is mistaken for a live channel." />
      <Callout tone="warning">Deferred. No customer-facing surface, payment link or chatbot exists in this build. Digital reminders point customers to ATB mobile or a branch.</Callout>
      <Card title="What P2 self-service would need" className="mt-3">
        <ul className="list-disc pl-5 text-sm">
          <li>Authenticated channel (ATB mobile / web) with identity verified by the bank, not by the collections layer.</li>
          <li>Promise-to-pay self-registration under the same server-enforced contact policy and promise rules (one active promise per customer, settlement allowance, no partial-cure).</li>
          <li>Payment initiation through core banking; the collections layer only receives verified postings.</li>
          <li>Hardship intake with restricted details stored in the support module, routed to S10.</li>
          <li>Opt-out / preference management mirrored into contact points and preferences (S20 import or master-data event).</li>
          <li>Approved templates (S16) in AZ/EN/RU; every message logged in the outbound log.</li>
        </ul>
      </Card>
    </>
  );
}
